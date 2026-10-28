import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { updateChatSession, getChatSession } from "../localDb.js";

const IS_WIN = process.platform === "win32";

/**
 * Ordered candidate locations for the Hermes CLI: explicit env override, then
 * PATH, then common venv/pipx install spots. Windows-only paths stay last so a
 * Linux/macOS server never depends on them.
 */
export function hermesBinCandidates() {
  const home = os.homedir();
  const out = [];
  if (process.env.HERMES_BIN) out.push(process.env.HERMES_BIN);

  const names = IS_WIN ? ["hermes.exe", "hermes.cmd", "hermes.bat", "hermes"] : ["hermes"];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) out.push(path.join(dir, name));
  }

  out.push(
    path.join(home, ".local", "bin", "hermes"),
    path.join(home, "hermes-agent", ".venv", "bin", "hermes"),
    path.join(home, ".local", "pipx", "venvs", "hermes-agent", "bin", "hermes"),
    "/opt/hermes-agent/.venv/bin/hermes",
    path.join(home, ".hermes", "venv", "bin", "hermes")
  );

  if (IS_WIN) {
    out.push(
      path.join(home, "hermes-agent", ".venv", "Scripts", "hermes.exe"),
      "F:\\tools\\hermes\\hermes-agent\\.venv\\Scripts\\hermes.exe"
    );
  }

  return [...new Set(out)];
}

/**
 * Check if local Hermes CLI is accessible.
 */
export async function isHermesAvailable() {
  const candidates = hermesBinCandidates();
  for (const bin of candidates) {
    try {
      await fs.access(bin, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK);
      return { available: true, path: bin };
    } catch {
      // try next candidate
    }
  }
  return {
    available: false,
    path: candidates[0] || "hermes",
    searched: candidates,
  };
}

/**
 * Extract clean string content from various message content representations.
 */
export function extractMessageText(msg) {
  if (!msg) return "";
  const content = msg.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.text) return part.text;
        if (part?.type === "text" && part.text) return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    if (typeof content.message === "string") return content.message;
  }
  return String(content || "");
}

/**
 * Format prior conversation turns so Hermes has full context on agent role switches
 * and subsequent turns without relying on an isolated CLI transcript.
 */
export function buildHermesPrompt({ messages = [], systemPrompt = "", maxTurns = 30, maxChars = 80000 }) {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const lastUserMsg = lastUserIndex >= 0 ? messages[lastUserIndex] : null;
  const currentQueryText = extractMessageText(lastUserMsg).trim();

  // Check for image attachments in last user message
  let imageAttachment = null;
  if (Array.isArray(lastUserMsg?.content)) {
    for (const part of lastUserMsg.content) {
      if (part?.type === "image_url" && part.image_url?.url) {
        imageAttachment = part.image_url.url;
        break;
      }
    }
  }

  const priorMessages = lastUserIndex > 0 ? messages.slice(0, lastUserIndex) : [];
  const turns = [];

  for (const m of priorMessages) {
    if (!m?.role) continue;
    const txt = extractMessageText(m).trim();

    if (m.role === "user") {
      if (txt) turns.push({ role: "User", text: txt });
    } else if (m.role === "assistant") {
      if (txt) turns.push({ role: "Assistant", text: txt });
    } else if (m.role === "tool") {
      const toolName = m.name || m.tool_call_id || "tool";
      const snippet = txt.length > 500 ? `${txt.slice(0, 500)}… [truncated]` : txt;
      if (snippet) turns.push({ role: `Tool (${toolName})`, text: snippet });
    }
  }

  // Cap recent turns to keep prompt bounded
  const recent = turns.slice(-maxTurns);
  const kept = [];
  let charCount = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const item = recent[i];
    const itemLen = item.text.length + item.role.length + 10;
    if (charCount + itemLen > maxChars && kept.length > 0) {
      kept.unshift({ role: "Note", text: "[Earlier conversation omitted to preserve context budget]" });
      break;
    }
    kept.unshift(item);
    charCount += itemLen;
  }

  let prompt = "";
  const cleanSystem = systemPrompt?.trim();
  if (cleanSystem && !cleanSystem.startsWith("Act as Hermes Agent")) {
    prompt += `[System Instructions / Constraints]\n${cleanSystem}\n\n`;
  }

  if (kept.length > 0) {
    const contextBody = kept.map((t) => `[${t.role}]\n${t.text}`).join("\n\n");
    prompt += `[Previous Conversation Context]\nThe following conversation occurred earlier in this session. Use this context to understand previous decisions, background, and requests:\n\n${contextBody}\n\n[End of Previous Context]\n\n`;
  }

  prompt += currentQueryText;

  return {
    queryText: currentQueryText,
    promptText: prompt,
    imageAttachment,
  };
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
    const hint = IS_WIN
      ? "pip install hermes-agent, or set HERMES_BIN in .env to the hermes.exe path"
      : "pipx install hermes-agent (or pip install), ensure `hermes` is on PATH, or set HERMES_BIN in .env to the binary path";
    throw new Error(
      `Hermes binary not found (tried ${hermesCheck.searched.length} locations, e.g. ${hermesCheck.searched.slice(0, 3).join(", ")}). ${hint}.`
    );
  }

  // Extract latest user message query with full conversation context
  const messages = run.request?.messages || run.messages || [];
  const { queryText, promptText, imageAttachment } = buildHermesPrompt({
    messages,
    systemPrompt: run.request?.systemPrompt || "",
  });

  if (!queryText.trim()) {
    throw new Error("No user message content found for Hermes Agent execution");
  }

  // Write query (including prior conversation context) to temporary file to bypass Windows command line limits
  const tmpQueryFile = path.join(os.tmpdir(), `hermes-q-${run.id}-${Date.now()}.txt`);
  await fs.writeFile(tmpQueryFile, promptText, "utf8");

  // Handle optional image attachment
  let tmpImageFile = null;
  if (imageAttachment) {
    if (imageAttachment.startsWith("data:image/")) {
      const match = imageAttachment.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (match) {
        const ext = match[1] === "jpeg" ? "jpg" : match[1];
        tmpImageFile = path.join(os.tmpdir(), `hermes-img-${run.id}-${Date.now()}.${ext}`);
        await fs.writeFile(tmpImageFile, Buffer.from(match[2], "base64"));
      }
    } else if (imageAttachment.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(imageAttachment)) {
      tmpImageFile = imageAttachment;
    }
  }

  const workspaceCwd = run.workspace || process.cwd();

  const args = [
    "chat",
    "--query-file", tmpQueryFile,
    "--format", "stream-json",
    "--yolo",
    "--source", "9router",
    "--in", workspaceCwd,
  ];

  if (tmpImageFile) {
    args.push("--image", tmpImageFile);
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
              run.projectMeta = { ...(run.projectMeta || {}), hermesSessionId: sid };
              updateChatSession(run.sessionId, {
                projectMeta: run.projectMeta,
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
    // Clean up temporary files
    try {
      await fs.unlink(tmpQueryFile);
    } catch {}
    if (tmpImageFile && tmpImageFile.includes(os.tmpdir())) {
      try {
        await fs.unlink(tmpImageFile);
      } catch {}
    }
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
