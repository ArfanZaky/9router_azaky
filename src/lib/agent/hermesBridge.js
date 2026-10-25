import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { updateChatSession, getChatSession } from "../localDb.js";

const DEFAULT_HERMES_BIN = "F:\\tools\\hermes\\hermes-agent\\.venv\\Scripts\\hermes.exe";

/**
 * Check if local Hermes CLI is accessible.
 */
export async function isHermesAvailable() {
  const bin = process.env.HERMES_BIN || DEFAULT_HERMES_BIN;
  try {
    await fs.access(bin);
    return { available: true, path: bin };
  } catch {
    return { available: false, path: bin };
  }
}

/**
 * Execute a chat turn through Hermes CLI using newline-delimited JSON stream.
 * Emits standard 9Router run events so frontend chat renders identically.
 */
export async function runHermesAgentLoop(run, helpers = {}) {
  const emit = helpers.emit || (async () => {});
  const checkpoint = helpers.checkpoint || (async () => {});
  const patchAssistant = helpers.patchAssistant || (() => {});
  const appendAssistantSegment = helpers.appendAssistantSegment || (() => {});

  const hermesCheck = await isHermesAvailable();
  if (!hermesCheck.available) {
    throw new Error(
      `Hermes binary not found at ${hermesCheck.path}. Set HERMES_BIN in .env or ensure Hermes Agent is installed at F:\\tools\\hermes\\hermes-agent.`
    );
  }

  // Extract latest user message query
  const messages = run.request?.messages || run.messages || [];
  const lastUserMsg = [...messages].reverse().find((m) => m?.role === "user");
  const queryText = typeof lastUserMsg?.content === "string"
    ? lastUserMsg.content
    : Array.isArray(lastUserMsg?.content)
      ? lastUserMsg.content.map((p) => p.text || "").join("\n")
      : String(lastUserMsg?.content || "");

  if (!queryText.trim()) {
    throw new Error("No user message content found for Hermes Agent execution");
  }

  // Write query to secure temporary file to bypass Windows command line escaping/length limits
  const tmpQueryFile = path.join(os.tmpdir(), `hermes-q-${run.id}-${Date.now()}.txt`);
  await fs.writeFile(tmpQueryFile, queryText, "utf8");

  // Determine resume session ID if already tracked in projectMeta
  let sessionMeta = run.projectMeta;
  if (!sessionMeta) {
    try {
      const sess = await getChatSession(run.sessionId, { includeMessages: false });
      sessionMeta = sess?.projectMeta || {};
    } catch {
      sessionMeta = {};
    }
  }

  const existingHermesSessionId = sessionMeta?.hermesSessionId;
  const workspaceCwd = run.workspace || process.cwd();

  const args = [
    "chat",
    "--query-file", tmpQueryFile,
    "--format", "stream-json",
    "--yolo",
    "--in", workspaceCwd,
  ];

  if (existingHermesSessionId) {
    args.push("--resume", existingHermesSessionId);
  }

  // If a model is explicitly specified in 9Router session, pass it to Hermes
  if (run.request?.model && !run.request.model.includes("default")) {
    args.push("-m", run.request.model);
  }

  await emit(run, "status", { phase: "Hermes starting…" });

  const activeToolCalls = new Map();

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(hermesCheck.path, args, {
        cwd: workspaceCwd,
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          HERMES_YOLO_MODE: "1",
        },
      });

      let exitHandled = false;
      const rl = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });

      const onAbort = () => {
        if (exitHandled) return;
        exitHandled = true;
        try {
          if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { windowsHide: true });
          } else {
            child.kill("SIGTERM");
          }
        } catch {}
        reject(new Error("Run stopped by user"));
      };

      if (run.abortController?.signal) {
        if (run.abortController.signal.aborted) {
          onAbort();
          return;
        }
        run.abortController.signal.addEventListener("abort", onAbort, { once: true });
      }

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("{")) return;
        try {
          const ev = JSON.parse(trimmed);
          void handleHermesJsonEvent(run, ev, {
            onSessionId: (sid) => {
              // Persist hermesSessionId in 9Router session projectMeta
              updateChatSession(run.sessionId, {
                projectMeta: {
                  ...(run.projectMeta || {}),
                  hermesSessionId: sid,
                },
              }).catch(() => {});
            },
            activeToolCalls,
            emit,
            checkpoint,
            patchAssistant,
            appendAssistantSegment,
          });
        } catch {
          // ignore non-JSON logging lines
        }
      });

      let stderrOutput = "";
      child.stderr.on("data", (chunk) => {
        stderrOutput += chunk.toString("utf8");
      });

      child.on("error", (err) => {
        if (exitHandled) return;
        exitHandled = true;
        reject(err);
      });

      child.on("close", (code) => {
        if (exitHandled) return;
        exitHandled = true;
        if (run.abortController?.signal) {
          run.abortController.signal.removeEventListener("abort", onAbort);
        }
        if (code !== 0 && !run.assistantText) {
          const detail = stderrOutput.trim() || `Hermes exited with code ${code}`;
          reject(new Error(detail));
        } else {
          resolve();
        }
      });
    });
  } finally {
    // Clean up temporary query file
    try {
      await fs.unlink(tmpQueryFile);
    } catch {}
  }
}

async function handleHermesJsonEvent(
  run,
  ev,
  { onSessionId, activeToolCalls, emit, checkpoint, patchAssistant, appendAssistantSegment }
) {
  const type = ev.type;

  if (type === "system") {
    if (ev.session_id) {
      onSessionId(ev.session_id);
    }
    if (ev.model) {
      await emit(run, "status", { phase: `Hermes active (${ev.model})` });
    }
    return;
  }

  if (type === "text") {
    const textChunk = ev.text || "";
    if (!textChunk) return;
    run.assistantText += textChunk;

    patchAssistant(run, { content: run.assistantText, status: "streaming" });
    appendAssistantSegment(run, { type: "text", content: run.assistantText });
    await emit(run, "text", { content: run.assistantText });
    await checkpoint(run);
    return;
  }

  if (type === "tool_use") {
    const toolName = ev.name || "tool";
    const callId = ev.tool_call_id || `call_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    activeToolCalls.set(toolName, callId);

    const callArgs = ev.input || {};
    const toolMsg = {
      id: callId,
      role: "tool",
      tool_call_id: callId,
      name: toolName,
      content: JSON.stringify({ status: "running", arguments: callArgs }),
      status: "running",
      createdAt: new Date().toISOString(),
    };

    run.messages.push(toolMsg);
    appendAssistantSegment(run, {
      type: "tool",
      callId,
      name: toolName,
      arguments: callArgs,
      status: "running",
      timestamp: new Date().toISOString(),
    });

    await emit(run, "tool_start", { id: callId, name: toolName, arguments: callArgs });
    await emit(run, "status", { phase: `Tool: ${toolName}…` });
    await checkpoint(run, true);
    return;
  }

  if (type === "tool_result") {
    const toolName = ev.name || "tool";
    const callId = ev.tool_call_id || activeToolCalls.get(toolName) || `call_${Date.now()}`;
    const output = typeof ev.output === "string" ? ev.output : JSON.stringify(ev.output || "");

    const toolIdx = run.messages.findIndex(
      (m) => m.role === "tool" && (m.tool_call_id === callId || (m.name === toolName && m.status === "running"))
    );
    const doneToolMsg = {
      id: callId,
      role: "tool",
      tool_call_id: callId,
      name: toolName,
      content: output,
      status: "done",
      createdAt: new Date().toISOString(),
    };

    if (toolIdx >= 0) {
      run.messages[toolIdx] = doneToolMsg;
    } else {
      run.messages.push(doneToolMsg);
    }

    // Update segment in assistant
    const assistant = run.messages.find((item) => item.id === run.assistantId);
    if (assistant?.segments) {
      assistant.segments = assistant.segments.map((segment) =>
        segment.type === "tool" && (segment.callId === callId || segment.name === toolName)
          ? { ...segment, content: output, status: "done" }
          : segment
      );
    }

    await emit(run, "tool_result", { id: callId, name: toolName, content: output });
    await emit(run, "status", { phase: `Tool done: ${toolName}` });
    await checkpoint(run, true);
    return;
  }

  if (type === "result") {
    if (ev.tokens) {
      const inTok = Number(ev.tokens.input || 0);
      const outTok = Number(ev.tokens.output || 0);
      run.tokenUsage = {
        prompt_tokens: inTok,
        completion_tokens: outTok,
        total_tokens: inTok + outTok,
      };
      await emit(run, "usage", {
        input_tokens: inTok,
        output_tokens: outTok,
        context_tokens: inTok + outTok,
      });
    }
    if (!run.assistantText && ev.text) {
      run.assistantText = ev.text;
      patchAssistant(run, { content: run.assistantText, status: "streaming" });
      appendAssistantSegment(run, { type: "text", content: run.assistantText });
      await emit(run, "text", { content: run.assistantText });
      await checkpoint(run, true);
    }
  }
}
