import { randomUUID } from "node:crypto";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { runAgentLoop } from "@/lib/agent/loop.js";
import {
  appendChatRunEvent,
  createChatRun,
  getChatRunRecord,
  getChatSession,
  listChatRunEvents,
  replaceChatMessages,
  updateChatRunRecord,
  updateChatSession,
  getActiveChatGoal,
  bumpChatGoalIteration,
  completeChatGoal,
  listChatMcpServers,
} from "@/lib/localDb";
import { resolveProjectWorkspace } from "./projectWorkspace.js";
import { listTools as listMcpTools, callTool as callMcpTool } from "./mcpClient.js";

const liveRuns = globalThis.__chatServerRuns || new Map();
globalThis.__chatServerRuns = liveRuns;

const GATE_TIMEOUT_MS = 120_000;

async function openGate(run, kind, payload) {
  // Auto-approve mode: approvals for this run are granted instantly without a card.
  if (kind === "approval" && run.autoApprove) {
    emit(run, "notice", {
      message: `Auto-approved: ${payload.tool || "tool"}`,
    }).catch(() => {});
    return true;
  }
  const id = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      run.gates.delete(id);
      emit(run, "notice", {
        message: `${kind === "approval" ? "Approval" : "Question"} timed out (auto-${kind === "approval" ? "denied" : "skipped"})`,
      }).catch(() => {});
      resolve(kind === "approval" ? false : null);
    }, GATE_TIMEOUT_MS);
    run.gates.set(id, { kind, resolve, timer });
    emit(run, kind === "approval" ? "approval" : "ask", { id, ...payload }).catch(() => {});
  });
}

function settleGates(run) {
  for (const gate of run.gates.values()) {
    clearTimeout(gate.timer);
    gate.resolve(gate.kind === "approval" ? false : null);
  }
  run.gates.clear();
}

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        return text(part);
      })
      .join("");
  }
  if (typeof value === "object") {
    if (typeof value.content === "string") return value.content;
    if (Array.isArray(value.content)) return text(value.content);
    if (typeof value.text === "string") return value.text;
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    if (value.error?.message) return String(value.error.message);
  }
  return String(value);
}

function makeTitle(value = "") {
  const normalized = text(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

async function callChatCompletionsForJudge(run, summary) {
  const body = {
    model: run.request.model,
    stream: false,
    messages: [
      { role: "system", content: "You are a goal judge. Decide whether the reported work truly meets the standing goal. A plan is not completion; an intention is not doing. Reply as JSON {\"met\": true|false, \"reason\": \"...\", \"next_step\": \"...\"}." },
      { role: "user", content: `Standing goal: ${run.goal.text}\n\nReported completed work:\n${summary || "(no summary provided)"}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
  };
  const request = new Request("http://9router.local/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.request.apiKey}` },
    body: JSON.stringify(body),
    signal: run.abortController.signal,
  });
  await ensureTranslators();
  const response = await handleChat(request);
  const data = await response.json().catch(() => ({}));
  const content = text(data.choices?.[0]?.message?.content);
  try {
    return JSON.parse(content);
  } catch {
    return { met: false, reason: content.slice(0, 200), next_step: "" };
  }
}

// Build OpenAI function-tool schemas from enabled MCP servers, namespaced
// mcp__<server>__<tool>. tools/list is cached per process (10 min) so every
// message does not re-spawn stdio servers / hit the network.
const mcpToolsCache = globalThis.__chatMcpToolsCache || new Map();
globalThis.__chatMcpToolsCache = mcpToolsCache;

async function loadMcpTools() {
  const servers = (await listChatMcpServers().catch(() => []))
    .filter((s) => s.enabled);
  const tools = [];
  const registry = []; // [{ name, server }]
  for (const server of servers) {
    const cacheKey = `${server.id}:${server.updatedAt}`;
    let listed = mcpToolsCache.get(cacheKey);
    if (!listed) {
      try {
        const fetched = await listMcpTools(server);
        listed = fetched;
        mcpToolsCache.set(cacheKey, { _at: Date.now(), list: fetched });
        if (mcpToolsCache.size > 200) {
          const now = Date.now();
          for (const [k, v] of mcpToolsCache) {
            if (v?._at && now - v._at > 600_000) mcpToolsCache.delete(k);
          }
        }
      } catch {
        continue;
      }
    }
    const toolList = listed?.list || listed;
    for (const t of toolList) {
      const name = `mcp__${server.name}__${t.name}`;
      tools.push({
        type: "function",
        function: {
          name,
          description: t.description || `MCP tool ${t.name} from ${server.name}`,
          parameters: t.inputSchema || { type: "object", properties: {}, additionalProperties: true },
        },
      });
      registry.push({ name, server });
    }
  }
  return { tools, registry };
}

function stoppedSummary(messages, assistantText, stopped) {
  if (assistantText?.trim()) return assistantText.trim();
  const tools = messages.filter((item) => item.role === "tool").map((item) => item.name).filter(Boolean);
  if (tools.length) {
    return stopped
      ? `(Stopped after tools: ${[...new Set(tools)].join(", ")})`
      : `(Completed tools: ${[...new Set(tools)].join(", ")})`;
  }
  return stopped
    ? "(Stopped)"
    : "(No response — model returned empty content. Try Agent OFF for fusion, or check panel credentials.)";
}

function parseSseLineBuffer(buffer, onEvent, initialEventName = "message") {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() || "";
  let eventName = initialEventName;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
    } else if (line.startsWith("data:")) {
      onEvent(eventName, line.slice(5).trim());
      eventName = "message";
    }
  }
  return { remainder, eventName };
}

function sanitizeRequest(body = {}) {
  return {
    model: body.model,
    messages: Array.isArray(body.messages) ? body.messages : [],
    systemPrompt: body.systemPrompt || "",
    apiKey: body.apiKey || "",
    accessMode: body.accessMode === "full" ? "full" : "sandbox",
    params: body.params || {},
    verify: body.verify === true,
    autoApprove: body.autoApprove === true,
    // 0 (or absent) = unlimited; otherwise clamp to a sane ceiling.
    maxSteps: (() => {
      const raw = Number(body.maxSteps);
      if (!Number.isFinite(raw)) return 0;
      if (raw <= 0) return 0;
      return Math.min(raw, 1000);
    })(),
  };
}

async function checkpoint(run, force = false) {
  const now = Date.now();
  if (!force && now - run.lastCheckpointAt < 1000) return;
  run.lastCheckpointAt = now;
  await replaceChatMessages(run.sessionId, run.messages).catch(() => {});
}

async function emit(run, type, data) {
  const event = { runId: run.id, seq: ++run.seq, type, data, createdAt: new Date().toISOString() };
  run.events.push(event);
  if (run.events.length > 1000) run.events.shift();
  await appendChatRunEvent(run.id, event).catch(() => {});
  for (const listener of run.listeners) {
    try { listener(event); } catch { /* ignore disconnected subscribers */ }
  }
  try {
    globalThis.__chatWsHub?.broadcast?.(run.id, event);
  } catch {
    // optional WS bridge from chat-server.mjs
  }
  return event;
}

function patchAssistant(run, patch) {
  run.messages = run.messages.map((message) => message.id === run.assistantId ? { ...message, ...patch } : message);
}

function appendAssistantSegment(run, segment) {
  const message = run.messages.find((item) => item.id === run.assistantId);
  if (!message) return;
  const segments = Array.isArray(message.segments) ? [...message.segments] : [];
  const last = segments.at(-1);
  if ((segment.type === "text" || segment.type === "reasoning") && last?.type === segment.type) {
    last.content = segment.content;
  } else {
    segments.push(segment);
  }
  patchAssistant(run, { segments });
}

function finishRunningTools(run, stopped) {
  run.messages = run.messages.map((message) => (
    message.role === "tool" && message.status === "running"
      ? {
          ...message,
          status: "done",
          content: `${text(message.content)}\n(${stopped ? "stopped" : "interrupted"})`.trim(),
        }
      : message
  ));
}

async function runPlainChat(run) {
  // Fusion combos fan out several models then judge — non-stream is more
  // reliable than partial SSE (empty deltas often finished as "(No response)").
  const modelName = String(run.request.model || "");
  const preferJson =
    /fusion/i.test(modelName) || run.request.params?.stream === false;
  const request = new Request("http://9router.local/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.request.apiKey}` },
    body: JSON.stringify({
      model: run.request.model,
      messages: run.request.messages,
      stream: !preferJson,
      temperature: run.request.params.temperature,
      max_tokens: run.request.params.max_tokens,
      top_p: run.request.params.top_p,
      ...(run.request.params.reasoning_effort ? { reasoning_effort: run.request.params.reasoning_effort } : {}),
    }),
    signal: run.abortController.signal,
  });
  await ensureTranslators();
  const response = await handleChat(request);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(text(body.error?.message || body.error || body.message) || `Request failed (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (preferJson || contentType.includes("application/json") || !response.body) {
    const body = await response.json().catch(() => ({}));
    if (body?.error) {
      throw new Error(text(body.error?.message || body.error || body.message) || "Chat failed");
    }
    run.assistantText = text(
      body.choices?.[0]?.message?.content ||
        body.choices?.[0]?.text ||
        body.output_text ||
        body.content
    );
    if (body.usage) {
      run.tokenUsage = body.usage;
      await emit(run, "usage", {
        input_tokens: body.usage.prompt_tokens || 0,
        output_tokens: body.usage.completion_tokens || 0,
        context_tokens: body.usage.prompt_tokens || 0,
      });
    }
    if (run.assistantText) {
      patchAssistant(run, { content: run.assistantText, status: "streaming" });
      await emit(run, "text", { content: run.assistantText });
      await checkpoint(run, true);
    }
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.json().catch(() => ({}));
    run.assistantText = text(body.choices?.[0]?.message?.content);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  const consume = async (_eventName, payload) => {
    if (!payload || payload === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk.error) {
      throw new Error(text(chunk.error?.message || chunk.error) || "Stream error");
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta || {};
    const reasoningPiece = text(delta.reasoning_content || delta.reasoning || "");
    const piece = text(delta.content || choice?.message?.content || chunk.output_text || chunk.text);
    if (chunk.usage) {
      run.tokenUsage = chunk.usage;
      await emit(run, "usage", {
        input_tokens: chunk.usage.prompt_tokens || 0,
        output_tokens: chunk.usage.completion_tokens || 0,
        context_tokens: chunk.usage.prompt_tokens || 0,
      });
    }
    if (reasoningPiece) {
      run.reasoning += reasoningPiece;
      patchAssistant(run, { reasoning: run.reasoning, status: "streaming" });
      appendAssistantSegment(run, { type: "reasoning", content: run.reasoning });
      await emit(run, "reasoning", { content: run.reasoning });
    }
    if (!piece) return;
    run.assistantText += piece;
    patchAssistant(run, { content: run.assistantText, status: "streaming" });
    await emit(run, "text", { content: run.assistantText });
    await checkpoint(run);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const entries = [];
    const parsed = parseSseLineBuffer(buffer, (name, payload) => entries.push([name, payload]), eventName);
    buffer = parsed.remainder;
    eventName = parsed.eventName;
    for (const [name, payload] of entries) await consume(name, payload);
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) await consume(eventName, tail.slice(5).trim());
  if (!run.assistantText.trim()) {
    throw new Error("Model returned empty response (check fusion panel / credentials)");
  }
}

async function runAgent(run) {
  const mcp = await loadMcpTools();
  await runAgentLoop({
    model: run.request.model,
    messages: run.request.messages,
    systemPrompt: run.request.systemPrompt,
    codebase: run.codebase,
    apiKey: run.request.apiKey,
    workspace: run.workspace,
    accessMode: run.request.accessMode,
    maxSteps: run.request.maxSteps,
    temperature: run.request.params.temperature,
    max_tokens: run.request.params.max_tokens,
    top_p: run.request.params.top_p,
    reasoning_effort: run.request.params.reasoning_effort || "",
    signal: run.abortController.signal,
    activeGoal: run.goal,
    mcpTools: mcp.tools,
    onMcpCall: async (name, args) => {
      const entry = mcp.registry.find((r) => r.name === name);
      if (!entry) return { ok: false, error: `Unknown MCP tool ${name}` };
      return callMcpTool(entry.server, name.slice(`mcp__${entry.server.name}__`.length), args);
    },
    onGoalJudge: async (summary) => {
      if (!run.goal) return { ok: false, error: "No active goal" };
      await bumpChatGoalIteration(run.sessionId).catch(() => {});
      const judge = await callChatCompletionsForJudge(run, summary);
      const met = judge?.met === true;
      if (met) {
        await completeChatGoal(run.sessionId, judge.reason || "").catch(() => {});
        run.goal = null;
        await emit(run, "notice", { message: `Goal verified complete: ${judge.reason || "met"}` });
        return { ok: true, met: true, reason: judge.reason || "" };
      }
      const next = judge?.next_step || "";
      await emit(run, "notice", { message: `Goal not yet met — ${next || "continue working"}` });
      return { ok: true, met: false, nextStep: next };
    },
    onEvent: async (type, data) => {
      // execute() owns the authoritative done event after final persistence.
      if (type === "done") return;
      if (type === "text") {
        run.assistantText = data.content || run.assistantText;
        patchAssistant(run, { content: run.assistantText, status: "streaming" });
        appendAssistantSegment(run, { type: "text", content: run.assistantText });
      } else if (type === "reasoning") {
        run.reasoning = data.content || run.reasoning;
        patchAssistant(run, { reasoning: run.reasoning, status: "streaming" });
        appendAssistantSegment(run, { type: "reasoning", content: run.reasoning });
      } else if (type === "message" && data.role === "assistant") {
        run.assistantText = data.content || run.assistantText;
        patchAssistant(run, { content: run.assistantText, tool_calls: data.tool_calls || null, status: data.tool_calls?.length ? "tool_calls" : "streaming" });
      } else if (type === "tool_start") {
        run.messages.push({ id: data.id, role: "tool", tool_call_id: data.id, name: data.name, content: JSON.stringify({ status: "running", arguments: data.arguments }), status: "running", createdAt: new Date().toISOString() });
        appendAssistantSegment(run, { type: "tool", callId: data.id, name: data.name, arguments: data.arguments, status: "running" });
      } else if (type === "tool_result") {
        const next = { id: data.id, role: "tool", tool_call_id: data.id, name: data.name, content: data.content, status: "done", createdAt: new Date().toISOString() };
        const index = run.messages.findIndex((item) => item.role === "tool" && item.tool_call_id === data.id && item.status === "running");
        if (index >= 0) run.messages[index] = next; else run.messages.push(next);
        const assistant = run.messages.find((item) => item.id === run.assistantId);
        if (assistant?.segments) {
          assistant.segments = assistant.segments.map((segment) => segment.type === "tool" && segment.callId === data.id
            ? { ...segment, content: data.content, status: "done" }
            : segment);
        }
      }
      await emit(run, type, data);
      await checkpoint(run, type === "tool_start" || type === "tool_result");
    },
    takeSteering: async () => run.steering.shift() || "",
    onTaskUpdate: async (items) => {
      run.tasks = items;
      await updateChatSession(run.sessionId, { tasks: items }).catch(() => {});
      await emit(run, "task_update", { items });
    },
    onDelegate: async ({ role, task }) => runSubAgent(run, { role, task }),
    onTeamRoster: async (args) => {
      const action = args?.action || "list";
      if (action === "register" && Array.isArray(args.members)) {
        for (const m of args.members) {
          if (m?.name) {
            run.teamRoster.set(m.name, {
              name: m.name,
              role: m.role || m.name,
              description: m.description || "",
              status: "idle",
            });
          }
        }
      }
      const list = Array.from(run.teamRoster.values());
      await emit(run, "team_roster_update", { roster: list });
      return { ok: true, roster: list };
    },
    onTeamTask: async (args) => {
      const action = args?.action || "list";
      if (action === "create") {
        const taskId = args.taskId || `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
        const taskObj = {
          id: taskId,
          title: args.title || "Untitled task",
          description: args.description || "",
          assignee: args.assignee || null,
          status: args.status || "pending",
          dependsOn: Array.isArray(args.dependsOn) ? args.dependsOn : [],
          updatedAt: new Date().toISOString(),
        };
        run.teamTasks.set(taskId, taskObj);
      } else if (action === "update" || action === "claim") {
        const taskObj = run.teamTasks.get(args.taskId);
        if (!taskObj) return { ok: false, error: `Task ${args.taskId} not found` };
        if (args.title) taskObj.title = args.title;
        if (args.description) taskObj.description = args.description;
        if (args.assignee) taskObj.assignee = args.assignee;
        if (args.status) taskObj.status = args.status;
        if (action === "claim" && args.assignee) {
          taskObj.assignee = args.assignee;
          taskObj.status = "in_progress";
        }
        taskObj.updatedAt = new Date().toISOString();
        run.teamTasks.set(args.taskId, taskObj);
      }
      const list = Array.from(run.teamTasks.values());
      await emit(run, "team_tasks_update", { tasks: list });
      return { ok: true, tasks: list };
    },
    onTeamMessage: async ({ to, message, context: msgCtx }) => {
      // Update roster member status to running
      const rosterMember = run.teamRoster.get(to);
      if (rosterMember) {
        rosterMember.status = "running";
        const rosterList = Array.from(run.teamRoster.values());
        await emit(run, "team_roster_update", { roster: rosterList });
      }
      if (!to || !message) return { ok: false, error: "Recipient ('to') and message are required" };
      const subId = `team_peer_${to}_${Date.now()}`;
      const sub = { id: subId, role: to, task: message, status: "running", events: [], seq: 0 };
      run.subAgents.set(subId, sub);
      await emit(run, "subagent_start", { id: subId, role: to, task: message });
      await emit(run, "team_message", { from: "peer", to, message, context: msgCtx || "" });

      // Run targeted sub-agent execution with peer role instructions and shared task board access
      let finalText = "";
      try {
        const targetMember = run.teamRoster.get(to);
        const roleDesc = targetMember?.description ? ` (${targetMember.description})` : "";
        const result = await runAgentLoop({
          model: run.request.model,
          messages: [{ role: "user", content: `${message}${msgCtx ? `\n\nContext:\n${msgCtx}` : ""}` }],
          systemPrompt: `You are the ${to} member${roleDesc} of an active Agent Team (DSH style). Collaborate with your team, execute your specialized role, use tools to verify facts, and provide clear output.`,
          apiKey: run.request.apiKey,
          workspace: run.workspace,
          accessMode: run.request.accessMode,
          maxSteps: run.request.maxSteps > 0 ? Math.min(run.request.maxSteps, 8) : 8,
          signal: run.abortController.signal,
          depth: 1,
          onEvent: async (type, data) => {
            const event = { seq: ++sub.seq, type, data, createdAt: new Date().toISOString() };
            sub.events.push(event);
            await emit(run, "subagent_event", { id: subId, event });
            if (type === "text") finalText = data.content || finalText;
          },
          onApproval: async ({ name, arguments: callArgs }) => {
            return await openGate(run, "approval", {
              subAgentId: subId,
              tool: name,
              arguments: JSON.stringify(callArgs || {}),
              message: `Allow team member ${to} to run ${name}?`,
            });
          },
          onAskUser: async (questions) => {
            return await openGate(run, "ask", { subAgentId: subId, questions });
          },
        });
        finalText = result.finalText || finalText;
        sub.status = "completed";
        await emit(run, "subagent_done", { id: subId, role: to, task: message, finalText });
        return { ok: true, recipient: to, response: finalText };
      } catch (err) {
        sub.status = "failed";
        await emit(run, "subagent_done", { id: subId, role: to, task: message, error: err?.message || String(err) });
        return { ok: false, recipient: to, error: err?.message || String(err) };
      }
    },
    onTeamBroadcast: async ({ topic, message }) => {
      await emit(run, "team_broadcast", { topic, message, timestamp: new Date().toISOString() });
      return { ok: true, topic, message, broadcastedTo: Array.from(run.teamRoster.keys()) };
    },
    onApproval: async ({ name, arguments: args }) => {
      const allowed = await openGate(run, "approval", {
        tool: name,
        arguments: JSON.stringify(args || {}),
        message: `Allow ${name} to run?`,
      });
      if (!allowed) {
        await emit(run, "notice", { message: `Tool ${name} was denied by user` });
        return false;
      }
      return true;
    },
    onAskUser: async (questions) => {
      const answer = await openGate(run, "ask", { questions });
      return answer ?? "";
    },
  });
}

async function runSubAgent(parent, { role, task }) {
  if (!task) return { ok: false, error: "Sub-agent task is required" };
  const id = randomUUID();
  const sub = { id, role, task, status: "running", events: [], seq: 0 };
  parent.subAgents.set(id, sub);
  await emit(parent, "subagent_start", { id, role, task });
  let finalText = "";
  try {
    const result = await runAgentLoop({
      model: parent.request.model,
      messages: [{ role: "user", content: task }],
      systemPrompt: `You are a ${role}. Complete only the delegated task. Do not modify files. Return concise evidence.`,
      apiKey: parent.request.apiKey,
      workspace: parent.workspace,
      accessMode: "sandbox",
      maxSteps: parent.request.maxSteps > 0 ? Math.min(parent.request.maxSteps, 6) : 6,
      signal: parent.abortController.signal,
      depth: 1,
      onEvent: async (type, data) => {
        const event = { seq: ++sub.seq, type, data, createdAt: new Date().toISOString() };
        sub.events.push(event);
        await emit(parent, "subagent_event", { id, event });
        if (type === "text") finalText = data.content || finalText;
      },
      onApproval: async ({ name, arguments: args }) => {
        const allowed = await openGate(parent, "approval", {
          subAgentId: id,
          tool: name,
          arguments: JSON.stringify(args || {}),
          message: `Allow sub-agent ${role} to run ${name}?`,
        });
        if (!allowed) {
          await emit(parent, "notice", { message: `Tool ${name} denied for sub-agent ${role}` });
          return false;
        }
        return true;
      },
      onAskUser: async (questions) => {
        const answer = await openGate(parent, "ask", { subAgentId: id, questions });
        return answer ?? "";
      },
    });
    finalText = result.finalText || finalText;
    sub.status = "completed";
    await emit(parent, "subagent_done", { id, role, task, finalText });
    return { ok: true, id, role, result: finalText };
  } catch (error) {
    sub.status = "failed";
    await emit(parent, "subagent_done", { id, role, task, error: error?.message || String(error) });
    return { ok: false, id, role, error: error?.message || String(error) };
  }
}

async function runVerification(run, finalText) {
  const body = {
    model: run.request.model,
    stream: false,
    messages: [
      { role: "system", content: "You are a strict verifier. Determine whether the assistant's final answer actually carried out the user's request. Reply JSON {\"met\": true|false, \"reason\": \"...\", \"gap\": \"what is missing\"}." },
      { role: "user", content: `User request was the conversation. Final answer:\n${finalText || "(empty)"}\n\nWas the request actually carried out?` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
  };
  const request = new Request("http://9router.local/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.request.apiKey}` },
    body: JSON.stringify(body),
    signal: run.abortController.signal,
  });
  await ensureTranslators();
  const response = await handleChat(request);
  const data = await response.json().catch(() => ({}));
  const content = text(data.choices?.[0]?.message?.content);
  try {
    return JSON.parse(content);
  } catch {
    return { met: true, reason: "", gap: "" };
  }
}

async function execute(run) {
  const startedAt = new Date().toISOString();
  await updateChatRunRecord(run.id, { status: "running", startedAt });
  await emit(run, "status", { phase: "running" });
  try {
    if (run.mode === "agent") await runAgent(run); else await runPlainChat(run);
    const stopped = run.abortController.signal.aborted;
    let content = stoppedSummary(run.messages, run.assistantText, stopped);
    if (!stopped && run.request.verify && content.trim()) {
      await emit(run, "notice", { message: "Verifying the answer…" });
      const verdict = await runVerification(run, content);
      if (verdict?.met === false && verdict?.gap) {
        content = `${content}\n\n(Verification flagged a gap: ${verdict.gap})`;
        await emit(run, "notice", { message: `Verification: ${verdict.reason || "gap found"}` });
      } else {
        await emit(run, "notice", { message: "Verification passed" });
      }
    }
    finishRunningTools(run, stopped);
    patchAssistant(run, { content, status: "done", tokenUsage: run.tokenUsage || undefined });
    await checkpoint(run, true);
    const session = await getChatSession(run.sessionId, { includeMessages: false });
    const title = !session?.title || session.title === "New chat" ? makeTitle(run.titleSeed) : session.title;
    await updateChatSession(run.sessionId, { title, model: run.request.model, providerId: run.providerId }).catch(() => {});
    const status = stopped ? "stopped" : "completed";
    run.status = status;
    const result = { messages: run.messages, finalText: content, title, tokenUsage: run.tokenUsage || null };
    await updateChatRunRecord(run.id, { status, result, finishedAt: new Date().toISOString() });
    await emit(run, "done", { ...result, stopped });
  } catch (error) {
    const message = run.abortController.signal.aborted ? "(Stopped)" : (error?.message || String(error));
    const content = run.abortController.signal.aborted
      ? stoppedSummary(run.messages, run.assistantText, true)
      : run.assistantText
        ? `${run.assistantText}\n\n(Run interrupted: ${message})`
        : `Run interrupted: ${message}`;
    finishRunningTools(run, run.abortController.signal.aborted);
    patchAssistant(run, { content, status: run.abortController.signal.aborted ? "done" : "error", error: run.abortController.signal.aborted ? undefined : message });
    await checkpoint(run, true);
    const status = run.abortController.signal.aborted ? "stopped" : "failed";
    run.status = status;
    await updateChatRunRecord(run.id, { status, error: status === "failed" ? message : null, result: { messages: run.messages, finalText: content }, finishedAt: new Date().toISOString() });
    await emit(run, status === "failed" ? "error" : "done", { message, messages: run.messages, finalText: content, stopped: status === "stopped" });
  } finally {
    setTimeout(() => liveRuns.delete(run.id), 30 * 60 * 1000).unref?.();
  }
}

export async function startServerChatRun(input) {
  const request = sanitizeRequest(input);
  if (!input.sessionId || !request.model || request.messages.length === 0) throw new Error("sessionId, model, and messages are required");
  const id = randomUUID();
  const session = await getChatSession(input.sessionId, { includeMessages: false });
  if (!session) throw new Error("Session not found");
  let workspace = process.cwd();
  if (session.workspacePath) {
    try {
      workspace = resolveProjectWorkspace(session.workspacePath);
    } catch {
      workspace = process.cwd();
    }
  }
  const codebase = session.codebase || input.codebase || "";
  const assistantId = input.assistantId || randomUUID();
  const messages = Array.isArray(input.persistedMessages)
    ? input.persistedMessages
    : [...request.messages, { id: assistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() }];
  const run = {
    id,
    sessionId: input.sessionId,
    mode: input.mode === "agent" ? "agent" : "plain",
    providerId: input.providerId || "",
    request,
    assistantId,
    messages,
    assistantText: "",
    reasoning: "",
    tokenUsage: null,
    titleSeed: input.titleSeed || "",
    workspace,
    codebase,
    steering: [],
    tasks: [],
    subAgents: new Map(),
    gates: new Map(),
    teamRoster: new Map([
      ["dev", { name: "dev", role: "Implementation Engineer", description: "Writes and updates code, runs tests", status: "idle" }],
      ["qa", { name: "qa", role: "Quality & Security Reviewer", description: "Finds regressions, edge cases, vulnerabilities", status: "idle" }],
      ["architect", { name: "architect", role: "System Architect", description: "Designs architecture, data flow, and boundaries", status: "idle" }],
    ]),
    teamTasks: new Map(),
    teamMessages: [],  // DSH-style activity feed
    goal: null,
    autoApprove: request.autoApprove,
    status: "queued",
    abortController: new AbortController(),
    listeners: new Set(),
    events: [],
    seq: 0,
    lastCheckpointAt: 0,
  };
  run.goal = (await getActiveChatGoal(run.sessionId).catch(() => null)) || null;
  await createChatRun({ id, sessionId: run.sessionId, mode: run.mode, request: { ...request, apiKey: "" } });
  liveRuns.set(id, run);
  void execute(run);
  return { id, sessionId: run.sessionId, status: "queued", lastSeq: 0 };
}

export async function getServerChatRun(id, after = 0) {
  const live = liveRuns.get(id);
  const record = await getChatRunRecord(id);
  if (!record) return null;
  const events = live ? live.events.filter((event) => event.seq > Number(after || 0)) : await listChatRunEvents(id, { after });
  return { ...record, events, live: !!live, lastSeq: live?.seq || events.at(-1)?.seq || 0 };
}

export function getLiveRunForSession(sessionId) {
  for (const run of liveRuns.values()) {
    if (run.sessionId !== sessionId) continue;
    if (run.status === "stopped" || run.status === "completed" || run.status === "failed") continue;
    if (run.abortController.signal.aborted) continue;
    return run;
  }
  return null;
}

/**
 * True only when a run for this session is genuinely executing in THIS process.
 * A DB row stuck in 'queued'/'running' after a server restart is stale and must
 * NOT block session edits — otherwise /clear, undo, fork, edit hang forever.
 * A finished run (status stopped/completed/failed) no longer counts as live.
 */
export function isRunLiveForSession(sessionId) {
  return !!getLiveRunForSession(sessionId);
}

/** Look up a sub-agent and its live events across all in-process runs. */
export function getSubAgentInfo(subId) {
  for (const run of liveRuns.values()) {
    const sub = run.subAgents?.get(subId);
    if (sub) {
      return {
        id: sub.id,
        role: sub.role,
        task: sub.task,
        status: sub.status,
        runId: run.id,
        sessionId: run.sessionId,
        events: sub.events || [],
        lastSeq: sub.seq || 0,
      };
    }
  }
  return null;
}

export async function stopServerChatRun(id) {
  const live = liveRuns.get(id);
  if (live) {
    settleGates(live);
    live.abortController.abort();
    return { id, stopping: true };
  }
  const record = await getChatRunRecord(id);
  return record ? { id, stopping: false, status: record.status } : null;
}

export async function steerServerChatRun(id, instruction) {
  const run = liveRuns.get(id);
  const value = String(instruction || "").trim();
  if (!run || run.abortController.signal.aborted) return null;
  if (!value) throw new Error("Steering instruction is required");
  run.steering.push(value.slice(0, 4000));
  await emit(run, "notice", { message: `Steering queued: ${value.slice(0, 180)}` });
  return { id, queued: true };
}

export function resolveChatGate(runId, gateId, outcome) {
  const run = liveRuns.get(runId);
  const gate = run?.gates?.get(gateId);
  if (!run || !gate) return null;
  clearTimeout(gate.timer);
  run.gates.delete(gateId);
  if (gate.kind === "approval") {
    gate.resolve(outcome === "allow");
  } else {
    gate.resolve(String(outcome || ""));
  }
  return { id, gateId, resolved: true };
}

export function setChatAutoApprove(runId, enabled) {
  const run = liveRuns.get(runId);
  if (!run) return null;
  run.autoApprove = enabled === true;
  return { id: runId, autoApprove: run.autoApprove };
}

export function subscribeServerChatRun(id, listener, after = 0) {
  const run = liveRuns.get(id);
  if (!run) return null;
  // Register first so events that arrive during replay are not lost, then
  // replay history with a local cursor shared by the live path.
  let cursor = Number(after || 0);
  const wrapped = (event) => {
    if (!event || event.seq <= cursor) return;
    cursor = event.seq;
    listener(event);
  };
  run.listeners.add(wrapped);
  for (const event of run.events) wrapped(event);
  return () => run.listeners.delete(wrapped);
}
