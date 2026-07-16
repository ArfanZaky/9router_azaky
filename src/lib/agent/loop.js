import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { executeTool, getOpenAiTools } from "./tools.js";
import { buildAgentSystemPrompt } from "./skills.js";
import { sanitizeToolHistory } from "./history.js";

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

function sseEncode(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseToolArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: String(raw) };
  }
}

function extractToolCalls(message) {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return [];
  return calls.map((c, i) => ({
    id: c.id || `call_${i}`,
    name: c.function?.name || c.name || "",
    arguments: parseToolArgs(c.function?.arguments ?? c.arguments),
    rawArguments: c.function?.arguments ?? c.arguments,
  }));
}

async function callChatCompletions({ model, messages, tools, apiKey, temperature, max_tokens, top_p }) {
  await ensureTranslators();
  const body = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    stream: false,
  };
  if (temperature != null) body.temperature = temperature;
  if (max_tokens != null) body.max_tokens = max_tokens;
  if (top_p != null) body.top_p = top_p;

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const request = new Request("http://9router.local/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const response = await handleChat(request, {
    endpoint: "/api/v1/chat/completions",
    body,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `Chat completions failed (${response.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

/**
 * Run multi-step tool agent and stream SSE events via onEvent.
 * Events: status | text | tool_start | tool_result | message | error | done
 */
export async function runAgentLoop({
  model,
  messages = [],
  systemPrompt = "",
  apiKey = "",
  workspace = process.cwd(),
  origin = "http://127.0.0.1:20128",
  accessMode = "sandbox",
  maxSteps = 12,
  temperature,
  max_tokens,
  top_p,
  signal,
  onEvent,
}) {
  const emit = (event, data) => {
    if (signal?.aborted) return;
    onEvent?.(event, data);
  };

  const mode = accessMode === "full" ? "full" : "sandbox";
  const tools = getOpenAiTools(mode);
  const agentSystem = buildAgentSystemPrompt({
    workspace,
    userSystem: systemPrompt,
    accessMode: mode,
  });

  // Normalize + sanitize tool pairing (Claude rejects orphan tool_result)
  const rawHistory = [];
  for (const m of messages) {
    if (!m?.role) continue;
    if (m.role === "system") continue; // replaced by agent system
    if (m.role === "tool") {
      rawHistory.push({
        role: "tool",
        tool_call_id: m.tool_call_id || m.id,
        id: m.id,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
      });
      continue;
    }
    if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.content ?? "" };
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) msg.tool_calls = m.tool_calls;
      rawHistory.push(msg);
      continue;
    }
    if (m.role === "user") {
      rawHistory.push({ role: "user", content: m.content ?? "" });
    }
  }
  const history = sanitizeToolHistory(rawHistory);

  const working = [{ role: "system", content: agentSystem }, ...history];
  const transcript = []; // UI-facing turns (assistant/tool)
  let finalText = "";

  emit("status", { phase: "start", maxSteps, toolCount: tools.length, workspace, accessMode: mode });

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) {
      emit("error", { message: "Aborted" });
      break;
    }

    emit("status", { phase: "thinking", step: step + 1 });

    let data;
    try {
      data = await callChatCompletions({
        model,
        messages: working,
        tools,
        apiKey,
        temperature,
        max_tokens,
        top_p,
      });
    } catch (e) {
      emit("error", { message: e.message || String(e) });
      break;
    }

    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const finish = choice?.finish_reason || "";
    const content = typeof message.content === "string" ? message.content : "";
    const toolCalls = extractToolCalls(message);

    if (content) {
      finalText = content;
      emit("text", { step: step + 1, content });
    }

    // Persist assistant message into working history
    const assistantMsg = {
      role: "assistant",
      content: content || null,
    };
    if (toolCalls.length) {
      assistantMsg.tool_calls = toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: {
          name: c.name,
          arguments:
            typeof c.rawArguments === "string"
              ? c.rawArguments
              : JSON.stringify(c.arguments || {}),
        },
      }));
    }
    working.push(assistantMsg);
    transcript.push({
      role: "assistant",
      content: content || "",
      tool_calls: assistantMsg.tool_calls || null,
      step: step + 1,
    });
    emit("message", {
      role: "assistant",
      content: content || "",
      tool_calls: assistantMsg.tool_calls || null,
      step: step + 1,
    });

    if (!toolCalls.length || finish === "stop") {
      break;
    }

    // Execute tools sequentially
    for (const call of toolCalls) {
      if (signal?.aborted) break;
      emit("tool_start", {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        step: step + 1,
      });

      const result = await executeTool(call.name, call.arguments, {
        workspace,
        apiKey,
        origin,
        accessMode: mode,
      });

      emit("tool_result", {
        id: call.id,
        name: call.name,
        content: result,
        step: step + 1,
      });

      const toolMsg = {
        role: "tool",
        tool_call_id: call.id,
        content: result,
      };
      working.push(toolMsg);
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: result,
        step: step + 1,
      });
      emit("message", {
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: result,
        step: step + 1,
      });
    }
  }

  emit("done", {
    finalText,
    transcript,
    steps: transcript.filter((t) => t.role === "assistant").length,
  });

  return { finalText, transcript };
}

export function createAgentSseResponse(run) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const onEvent = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(event, data)));
        } catch {
          // ignore enqueue after close
        }
      };
      Promise.resolve()
        .then(() => run(onEvent))
        .catch((err) => {
          onEvent("error", { message: err?.message || String(err) });
          onEvent("done", { finalText: "", transcript: [], steps: 0 });
        })
        .finally(() => {
          closed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
