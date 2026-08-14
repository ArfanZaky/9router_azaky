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
        if ((!part?.type || part.type === "text" || part.type === "output_text") && typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (typeof message.text === "string") return message.text;
  return "";
}

async function callChatCompletions({ model, messages, tools, apiKey, temperature, max_tokens, top_p, signal, reasoning_effort }) {
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
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const request = new Request("http://9router.local/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
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

function extractReasoning(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.reasoning_content === "string") return message.reasoning_content;
  if (typeof message.reasoning === "string") return message.reasoning;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part?.type === "reasoning" || part?.type === "thinking")
      .map((part) => part.text || part.thinking || "")
      .join("");
  }
  return "";
}

/**
 * Run multi-step tool agent and stream SSE events via onEvent.
 * Events: status | text | tool_start | tool_result | message | error | done
 */
export async function runAgentLoop({
  model,
  messages = [],
  systemPrompt = "",
  codebase = "",
  apiKey = "",
  workspace = process.cwd(),
  origin = "http://127.0.0.1:20128",
  accessMode = "sandbox",
  maxSteps = 0, // 0 = unlimited (natural end / Stop / repetition guard still apply)
  temperature,
  max_tokens,
  top_p,
  signal,
  onEvent,
  takeSteering,
  onTaskUpdate,
  onDelegate,
  onApproval,
  onAskUser,
  activeGoal,
  onGoalJudge,
  onMcpCall,
  mcpTools = [],
  depth = 0,
  reasoning_effort,
}) {
  const emit = async (event, data) => {
    if (signal?.aborted) return;
    await onEvent?.(event, data);
  };

  const mode = accessMode === "full" ? "full" : "sandbox";
  const baseTools = getOpenAiTools(mode);
  const tools = [...baseTools, ...(Array.isArray(mcpTools) ? mcpTools : [])];
  const agentSystem = buildAgentSystemPrompt({
    workspace,
    userSystem: systemPrompt,
    accessMode: mode,
  }) + (activeGoal
    ? `\n\n## Standing goal\nYou are working toward a standing goal that outlives this turn:\n${activeGoal.text}\nContinue toward it every turn. When you believe it is complete, call goal_update with action=report_complete to have a judge verify.`
    : "") + (codebase
      ? `\n\n## Codebase\nThis session works on codebase: ${codebase}. When the user asks about code, clone or reference this repository as needed.`
      : "");

  // Summarize earlier turns (everything except the most recent user turn and
  // its pending tool replies) into one compact block so long runs survive the
  // model's context window. Returns true when compaction actually happened.
  const compactWorking = async () => {
    const dropUntil = Math.max(0, working.length - 6);
    const old = working.slice(1, dropUntil); // keep system + recent tail
    if (old.length < 3) return false;
    try {
      const compact = await callChatCompletions({
        model,
        messages: [
          { role: "system", content: "You summarize a conversation. Keep key decisions, verified facts, file paths, and unfinished work. Output only the summary." },
          ...old,
        ],
        tools: [],
        apiKey,
        temperature: 0.3,
        max_tokens: 1200,
        top_p: 1,
        signal,
        reasoning_effort: "",
      });
      const summary = extractMessageText(compact?.choices?.[0]?.message);
      if (!summary || summary.length < 20) return false;
      const tail = working.slice(dropUntil);
      working.length = 0;
      working.push(
        { role: "system", content: `${agentSystem}\n\n## Compacted earlier conversation\n${summary}` },
        ...tail,
      );
      return true;
    } catch {
      return false;
    }
  };

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
  let lastFinish = "";
  let lastIncomplete = false;
  const callCounts = new Map();
  const repeatLimit = 3;
  const repeatStopLimit = 6;
  let compacted = false;

  await emit("status", { phase: "start", maxSteps: maxSteps || 0, toolCount: tools.length, workspace, accessMode: mode });

  let lastError = "";
  const limit = maxSteps > 0 ? maxSteps : Infinity;
  let lastStep = 0;
  for (let step = 0; step < limit; step++) {
    lastStep = step + 1;
    if (signal?.aborted) {
      break;
    }

    await emit("status", { phase: "thinking", step: step + 1 });

    let data;
    const heartbeat = setInterval(() => {
      emit("status", { phase: "thinking", step: step + 1, heartbeat: true }).catch(() => {});
    }, 20_000);
    try {
      data = await callChatCompletions({
        model,
        messages: working,
        tools,
        apiKey,
        temperature,
        max_tokens,
        top_p,
        signal,
        reasoning_effort,
      });
    } catch (e) {
      lastError = e.message || String(e);
      throw new Error(lastError);
    } finally {
      clearInterval(heartbeat);
    }

    if (data?.error) {
      lastError =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || JSON.stringify(data.error);
      throw new Error(lastError);
    }

    // Compaction: if we are approaching the context window and have several
    // prior turns, summarize older messages once.
    if (!compacted && working.length > 8) {
      const promptTokens = Number(data?.usage?.prompt_tokens) || 0;
      const contextWindow = Number(data?.usage?.context_window) || 0;
      if (contextWindow > 0 && promptTokens > contextWindow * 0.75) {
        compacted = true;
        if (await compactWorking()) {
          await emit("notice", { message: "Context compacted — earlier turns summarized" });
        }
      }
    }

    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const finish = choice?.finish_reason || "";
    lastFinish = finish;
    const content = extractMessageText(message);
    const reasoning = extractReasoning(message);
    const toolCalls = extractToolCalls(message);

    if (data?.usage) {
      await emit("usage", {
        input_tokens: data.usage.prompt_tokens || 0,
        output_tokens: data.usage.completion_tokens || 0,
        context_tokens: data.usage.prompt_tokens || 0,
      });
    }

    if (reasoning) await emit("reasoning", { step: step + 1, content: reasoning });

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
      if (incomplete) {
        // Keep going (unlimited): push a continue turn instead of giving up.
        // `continue` on every truncated reply, no one-shot cap, so long outputs
        // are never cut short by an arbitrary "too truncated" heuristic.
        working.push({
          role: "user",
          content: "Your previous response was cut off. Continue from where it stopped and finish the task. Use tools if needed.",
        });
        lastIncomplete = false;
        continue;
      }
      // Model finished cleanly (no tools, not truncated).
      lastIncomplete = false;
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

      const fingerprint = `${call.name}|${JSON.stringify(call.arguments || {})}`;
      const count = (callCounts.get(fingerprint) || 0) + 1;
      callCounts.set(fingerprint, count);
      if (count === repeatLimit) {
        await emit("notice", {
          message: `You have called ${call.name} with the same arguments several times and it is not getting you anywhere. Do not call it again. Either try a different approach, or say what is blocking you.`,
        });
      }
      if (count >= repeatStopLimit) {
        await emit("tool_result", {
          id: call.id,
          name: call.name,
          content: JSON.stringify({ ok: false, error: `Repeated identical tool call ${call.name} (${count}x). Stopping to avoid a loop.` }),
          step: step + 1,
        });
        break;
      }

      let result;
      if (call.name.startsWith("mcp__") && onMcpCall) {
        try {
          result = JSON.stringify(await onMcpCall(call.name, call.arguments || {}));
        } catch (e) {
          result = JSON.stringify({ ok: false, error: e?.message || String(e) });
        }
      } else {
        result = await executeTool(call.name, call.arguments, {
          workspace,
          apiKey,
          origin,
          accessMode: mode,
          onTaskUpdate,
          onDelegate: depth < 1 ? onDelegate : null,
          onApproval,
          onAskUser,
          onGoalJudge,
          onProgress: async (chunk) => {
            await emit("tool_progress", { id: call.id, name: call.name, chunk });
          },
        });
      }

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

    const steering = await takeSteering?.();
    if (steering) {
      working.push({ role: "user", content: `[Steering instruction received while working]\n${steering}` });
      await emit("notice", { message: `Steering applied: ${steering}` });
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
          content: "The previous exchange is being wrapped up. Provide a concise summary of what was accomplished, what was verified, and any remaining work. Keep it short.",
        }],
        tools: [],
        apiKey,
        temperature,
        max_tokens,
        top_p,
        signal,
        reasoning_effort,
      });
      if (data?.error) {
        throw new Error(typeof data.error === "string" ? data.error : data.error?.message || JSON.stringify(data.error));
      }
      const summary = extractMessageText(data?.choices?.[0]?.message);
      if (summary) {
        finalText = summary;
        const nextStep = (limit === Infinity ? lastStep : limit) + 1;
        transcript.push({ role: "assistant", content: summary, tool_calls: null, step: nextStep });
        await emit("text", { step: nextStep, content: summary });
        await emit("message", { role: "assistant", content: summary, tool_calls: null, step: nextStep });
      }
    } catch (error) {
      finalText = `${finalText ? `${finalText}\n\n` : ""}(Agent response was cut off; final summary failed: ${error.message || String(error)})`;
      await emit("text", { step: lastStep + 1, content: finalText });
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
