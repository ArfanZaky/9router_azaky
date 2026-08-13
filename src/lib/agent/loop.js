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

/** OpenAI content may be string or [{type:"text",text}] (Claude/Gemini after translate). */
function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (typeof message.reasoning_content === "string" && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

async function callChatCompletions({ model, messages, tools, apiKey, temperature, max_tokens, top_p }) {
  await ensureTranslators();
  const body = {
    model,
    messages,
    stream: false,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
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
  const emit = async (event, data) => {
    if (signal?.aborted) return;
    await onEvent?.(event, data);
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
  let endedWithToolCalls = false;
  let continuationUsed = false;
  let lastFinish = "";
  let lastIncomplete = false;

  await emit("status", { phase: "start", maxSteps, toolCount: tools.length, workspace, accessMode: mode });

  let lastError = "";
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) {
      break;
    }

    await emit("status", { phase: "thinking", step: step + 1 });

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
      lastError = e.message || String(e);
      throw new Error(lastError);
    }

    if (data?.error) {
      lastError =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || JSON.stringify(data.error);
      throw new Error(lastError);
    }

    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const finish = choice?.finish_reason || "";
    lastFinish = finish;
    const content = extractMessageText(message);
    const toolCalls = extractToolCalls(message);

    if (content) {
      finalText = content;
      await emit("text", { step: step + 1, content });
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
    await emit("message", {
      role: "assistant",
      content: content || "",
      tool_calls: assistantMsg.tool_calls || null,
      step: step + 1,
    });

    endedWithToolCalls = toolCalls.length > 0;
    if (!toolCalls.length) {
      const incomplete = finish === "length" || content.trimEnd().endsWith(":");
      if (incomplete && !continuationUsed && step < maxSteps - 1) {
        continuationUsed = true;
        working.push({
          role: "user",
          content: "Continue the unfinished task now. Use tools when changes or checks are required, then provide a final summary.",
        });
        continue;
      }
      // Track truncated responses so we can synthesize a summary after the loop
      // (a "length" cut or trailing ":" means the model was still writing).
      lastIncomplete = Boolean(incomplete);
      break;
    }
    lastIncomplete = false;

    // Execute tools sequentially
    for (const call of toolCalls) {
      if (signal?.aborted) break;
      await emit("tool_start", {
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

      await emit("tool_result", {
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
      await emit("message", {
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: result,
        step: step + 1,
      });
    }
  }

  // Synthesize a final summary when the model was truncated (max_tokens cut or
  // trailing ":") — otherwise the chat would just stop mid-sentence. Also runs
  // for tool-step exhaustion. Never call tools in this final pass.
  const needsSummary = (endedWithToolCalls || lastIncomplete) && !signal?.aborted;
  if (needsSummary) {
    try {
      const data = await callChatCompletions({
        model,
        messages: [...working, {
          role: "user",
          content: endedWithToolCalls
            ? "The tool-step limit was reached. Summarize completed work, verification, and anything still unfinished. Do not call tools."
            : "Your previous response was cut off. Continue from where it stopped and provide a complete final answer with a short summary. Do not call tools.",
        }],
        tools: [],
        apiKey,
        temperature,
        max_tokens,
        top_p,
      });
      if (data?.error) {
        throw new Error(typeof data.error === "string" ? data.error : data.error?.message || JSON.stringify(data.error));
      }
      const summary = extractMessageText(data?.choices?.[0]?.message);
      if (summary) {
        finalText = summary;
        transcript.push({ role: "assistant", content: summary, tool_calls: null, step: maxSteps + 1 });
        await emit("text", { step: maxSteps + 1, content: summary });
        await emit("message", { role: "assistant", content: summary, tool_calls: null, step: maxSteps + 1 });
      }
    } catch (error) {
      finalText = `${finalText ? `${finalText}\n\n` : ""}(Agent response was cut off; final summary failed: ${error.message || String(error)})`;
      await emit("text", { step: maxSteps + 1, content: finalText });
    }
  }

  if (!finalText && lastError && !signal?.aborted) {
    finalText = `Error: ${lastError}`;
  }

  await emit("done", {
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
