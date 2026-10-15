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
  getSettings,
  updateSettings,
} from "@/lib/localDb";
import { resolveProjectWorkspace } from "./projectWorkspace.js";
import { saveDualTierMemory } from "@/lib/agent/memory.js";
import { listTools as listMcpTools, callTool as callMcpTool } from "./mcpClient.js";

const liveRuns = globalThis.__chatServerRuns || new Map();
globalThis.__chatServerRuns = liveRuns;

const GATE_TIMEOUT_MS = 120_000;

function findTask(teamTasks, query) {
  if (!query || !teamTasks) return null;
  const qStr = String(query).trim();
  if (teamTasks.has(qStr)) return teamTasks.get(qStr);

  const qLower = qStr.toLowerCase();
  // Match by numeric index e.g. "1", 1, "task_1", "#1"
  const numMatch = qLower.match(/^(?:task_?|#)?(\d+)$/i);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10);
    const list = Array.from(teamTasks.values());
    if (idx >= 1 && idx <= list.length) {
      return list[idx - 1];
    }
  }

  // Match by exact ID case-insensitive or exact title
  for (const t of teamTasks.values()) {
    if (t.id && t.id.toLowerCase() === qLower) return t;
    if (t.title && t.title.toLowerCase().trim() === qLower) return t;
  }
  // Match by title substring
  for (const t of teamTasks.values()) {
    if (t.title && t.title.toLowerCase().includes(qLower)) return t;
  }
  return null;
}

async function saveTeamState(run) {
  if (!run?.sessionId) return;
  const rosterList = Array.from(run.teamRoster?.values() || []);
  let taskList = Array.from(run.teamTasks?.values() || []);
  if (taskList.length === 0 && Array.isArray(run.tasks) && run.tasks.length > 0) {
    taskList = run.tasks.map((t, idx) => ({
      id: `task_${idx + 1}`,
      title: t.content || `Task ${idx + 1}`,
      description: t.content || "",
      assignee: "orchestrator",
      status: t.status === "in_progress" ? "in_progress" : t.status === "completed" ? "completed" : "pending",
      dependsOn: idx > 0 ? [`task_${idx}`] : [],
      updatedAt: new Date().toISOString(),
    }));
  }
  const messageList = Array.isArray(run.teamMessages) ? run.teamMessages : [];
  await updateChatSession(run.sessionId, {
    teamState: {
      roster: rosterList,
      tasks: taskList,
      messages: messageList,
    },
  }).catch(() => {});
}

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
    emit(run, kind === "approval" ? "approval" : "ask", { id, runId: run.id, ...payload }).catch(() => {});
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

async function runBackgroundReflection(run, content) {
  if (run.mode !== "agent" || !run.workspace || !run.request?.apiKey) return;
  const lastUserMsg = [...(run.request.messages || [])].reverse().find((m) => m?.role === "user");
  const userText = text(lastUserMsg?.content).trim();
  if (!userText || userText.length < 5) return;
  if (/^(hi|hello|hey|halo|test|ok|oke|sip|thanks|terima kasih)[\s.!]*$/i.test(userText)) return;

  const prompt = `You are the Hermes Self-Improvement Background Reviewer for 9Router Agent.
Analyze this completed interaction to extract durable learnings:
1. Durable Project Fact (MEMORY.md): Stack nuance, build command, port, error cause, or architecture convention. (Max 1-2 bullet points starting with "- ").
2. Durable User Preference (USER.md): Explicit user style, communication rule, language preference, or workflow constraint. (Max 1 bullet point starting with "- ").
Rules:
- Do NOT save ephemeral session states or transient task progress.
- Only return durable, reusable facts. If nothing new was learned, set shouldUpdate: false.
- Anti-Slop: No generic filler, no em dash.

Completed Turn:
User Request: ${userText.slice(0, 800)}
Assistant Output: ${String(content || "").slice(0, 1000)}

Reply JSON only:
{
  "shouldUpdate": boolean,
  "projectFact": "- fact" or null,
  "userPreference": "- pref" or null
}`;

  const body = {
    model: run.request.model,
    stream: false,
    messages: [
      { role: "system", content: "You extract durable memory facts from assistant turns. Reply JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 400,
  };

  try {
    const request = new Request("http://9router.local/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.request.apiKey}` },
      body: JSON.stringify(body),
    });
    await ensureTranslators();
    const response = await handleChat(request);
    const data = await response.json().catch(() => ({}));
    const raw = text(data.choices?.[0]?.message?.content);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.shouldUpdate) {
      if (parsed.projectFact && typeof parsed.projectFact === "string") {
        saveDualTierMemory(run.workspace, { type: "project", content: parsed.projectFact, mode: "append" });
      }
      if (parsed.userPreference && typeof parsed.userPreference === "string") {
        saveDualTierMemory(run.workspace, { type: "user", content: parsed.userPreference, mode: "append" });
      }
    }
  } catch {
    // Silent background execution
  }
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
  for (const listener of run.listeners) {
    try { listener(event); } catch { /* ignore disconnected subscribers */ }
  }
  try {
    globalThis.__chatWsHub?.broadcast?.(run.id, event);
  } catch {
    // optional WS bridge from chat-server.mjs
  }
  appendChatRunEvent(run.id, event).catch(() => {});
  return event;
}

function patchAssistant(run, patch) {
  run.messages = run.messages.map((message) => message.id === run.assistantId ? { ...message, ...patch } : message);
}

function appendAssistantSegment(run, segment) {
  const message = run.messages.find((item) => item.id === run.assistantId);
  if (!message) return;
  const segments = Array.isArray(message.segments) ? [...message.segments] : [];
  if (segment.type === "text" || segment.type === "reasoning") {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].type === "tool") break;
      if (segments[i].type === segment.type) {
        segments[i] = { ...segments[i], content: segment.content };
        patchAssistant(run, { segments });
        return;
      }
    }
  }
  segments.push(segment);
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
    const reasoningPiece = text(delta.reasoning_content || delta.reasoning || delta.thinking || delta.thought || "");
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
    appendAssistantSegment(run, { type: "text", content: run.assistantText });
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
  const isRedmineTask = Boolean(run.projectMeta?.redmineIssueId);

  // Dynamic context injection: provide current Task Board & Roster so model sees existing tasks on subsequent turns
  let teamContextPrompt = "";
  if (run.teamTasks && run.teamTasks.size > 0) {
    const taskLines = Array.from(run.teamTasks.values()).map((t, idx) => {
      const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[/]" : "[ ]";
      const assignee = t.assignee ? ` @${t.assignee}` : "";
      const deps = Array.isArray(t.dependsOn) && t.dependsOn.length > 0 ? ` (depends on: ${t.dependsOn.join(", ")})` : "";
      return `- ${mark} ${t.id}: ${t.title || t.description || `Task ${idx + 1}`} [status: ${t.status}${assignee}]${deps}`;
    }).join("\n");

    teamContextPrompt += `\n\n## Shared Team Task Board (Current State)\n` +
      `Active tasks on the board:\n${taskLines}\n\n` +
      `MANDATORY Task Board Rules for all subsequent tasks and turns:\n` +
      `- When starting any pending or subsequent task, claim it with team_post_task(action: 'claim', taskId: '<id>', assignee: '<role>') to mark it 'in_progress'.\n` +
      `- When completing a task, immediately mark it with team_post_task(action: 'update', taskId: '<id>', status: 'completed').\n` +
      `- For new requests or additional work, create new task(s) with team_post_task(action: 'create', title: '...').\n` +
      `- Maintain the board continuously across all turns and steps.`;
  }

  if (run.teamRoster && run.teamRoster.size > 0) {
    const rosterLines = Array.from(run.teamRoster.values()).map((m) =>
      `- ${m.name} (${m.role || m.name}): ${m.description || "Specialist agent"} [status: ${m.status || "idle"}]`
    ).join("\n");
    teamContextPrompt += `\n\n## Agent Team Roster:\n${rosterLines}\nDispatch specialized work with team_send_message and announce discoveries with team_broadcast.`;
  }

  const effectiveSystemPrompt = [run.request.systemPrompt, teamContextPrompt].filter(Boolean).join("\n");

  await runAgentLoop({
    model: run.request.model,
    messages: run.request.messages,
    systemPrompt: effectiveSystemPrompt,
    codebase: run.codebase,
    apiKey: run.request.apiKey,
    workspace: run.workspace,
    sessionId: run.sessionId,
    accessMode: run.request.accessMode,
    maxSteps: run.request.maxSteps,
    temperature: run.request.params.temperature,
    max_tokens: run.request.params.max_tokens,
    top_p: run.request.params.top_p,
    reasoning_effort: run.request.params.reasoning_effort || "",
    signal: run.abortController.signal,
    activeGoal: run.goal,
    isRedmineTask,
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
      
      // Always keep teamTasks DAG synchronized with todo items
      (items || []).forEach((item, idx) => {
        const tid = `task_${idx + 1}`;
        const existing = run.teamTasks.get(tid) || findTask(run.teamTasks, tid) || findTask(run.teamTasks, item.content);
        const taskStatus = item.status === "in_progress" ? "in_progress" : item.status === "completed" ? "completed" : "pending";
        if (existing) {
          existing.title = item.content || existing.title;
          existing.status = taskStatus;
          existing.updatedAt = new Date().toISOString();
          run.teamTasks.set(existing.id, existing);
        } else {
          run.teamTasks.set(tid, {
            id: tid,
            title: item.content || `Task ${idx + 1}`,
            description: item.content || "",
            assignee: "orchestrator",
            status: taskStatus,
            dependsOn: idx > 0 ? [`task_${idx}`] : [],
            updatedAt: new Date().toISOString(),
          });
        }
      });
      const list = Array.from(run.teamTasks.values());
      await emit(run, "team_tasks_update", { tasks: list });
      await saveTeamState(run);
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
      await saveTeamState(run);
      return { ok: true, roster: list };
    },
    onTeamTask: async (args) => {
      const action = args?.action || "list";
      if (action === "create") {
        const rawItems = Array.isArray(args.tasks) ? args.tasks : Array.isArray(args.items) ? args.items : [args];
        for (const item of rawItems) {
          if (!item || (!item.title && !item.content && !item.description)) continue;
          const nextIdx = run.teamTasks.size + 1;
          const taskId = item.taskId || item.id || `task_${nextIdx}`;
          const depends = Array.isArray(item.dependsOn) ? item.dependsOn : [];
          const isDepSatisfied = depends.length === 0 || depends.every((d) => {
            const prior = findTask(run.teamTasks, d);
            return prior && prior.status === "completed";
          });
          const taskObj = {
            id: taskId,
            title: item.title || item.content || item.description || `Task ${nextIdx}`,
            description: item.description || item.content || "",
            assignee: item.assignee || "orchestrator",
            status: item.status || (isDepSatisfied ? "pending" : "blocked"),
            dependsOn: depends,
            updatedAt: new Date().toISOString(),
          };
          run.teamTasks.set(taskId, taskObj);
        }
      } else if (action === "update" || action === "claim") {
        const targetQuery = args.taskId || args.id || args.title;
        const taskObj = findTask(run.teamTasks, targetQuery);
        if (!taskObj) return { ok: false, error: `Task "${targetQuery}" not found on board` };
        if (args.title) taskObj.title = args.title;
        if (args.description) taskObj.description = args.description;
        if (args.assignee) taskObj.assignee = args.assignee;
        if (args.status) taskObj.status = args.status;
        if (action === "claim") {
          if (args.assignee) taskObj.assignee = args.assignee;
          taskObj.status = "in_progress";
        }
        taskObj.updatedAt = new Date().toISOString();
        run.teamTasks.set(taskObj.id, taskObj);

        if (taskObj.status === "completed") {
          for (const other of run.teamTasks.values()) {
            if (other.status === "blocked" && Array.isArray(other.dependsOn)) {
              const allDone = other.dependsOn.every((depId) => {
                const dt = findTask(run.teamTasks, depId);
                return dt && dt.status === "completed";
              });
              if (allDone) {
                other.status = "pending";
                other.updatedAt = new Date().toISOString();
              }
            }
          }
        }
      }
      const list = Array.from(run.teamTasks.values());
      await emit(run, "team_tasks_update", { tasks: list });
      await saveTeamState(run);
      return { ok: true, tasks: list };
    },
    onTeamMessage: async ({ to, message, context: msgCtx }) => {
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
      await emit(run, "subagent_start", { id: subId, role: to, task: message, sessionId: run.sessionId });
      const msgObj = { id: subId, type: "message", from: "peer", to, message, context: msgCtx || "", timestamp: new Date().toISOString() };
      run.teamMessages.push(msgObj);
      await emit(run, "team_message", msgObj);
      await saveTeamState(run);

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
          sessionId: run.sessionId,
          accessMode: run.request.accessMode,
          maxSteps: run.request.maxSteps > 0 ? Math.min(run.request.maxSteps, 8) : 8,
          signal: run.abortController.signal,
          depth: 1,
          isRedmineTask,
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
        if (rosterMember) {
          rosterMember.status = "completed";
          const rosterList = Array.from(run.teamRoster.values());
          await emit(run, "team_roster_update", { roster: rosterList });
        }
        await emit(run, "subagent_done", { id: subId, role: to, task: message, finalText, sessionId: run.sessionId });
        await saveTeamState(run);
        return { ok: true, recipient: to, response: finalText };
      } catch (err) {
        sub.status = "failed";
        if (rosterMember) {
          rosterMember.status = "failed";
          const rosterList = Array.from(run.teamRoster.values());
          await emit(run, "team_roster_update", { roster: rosterList });
        }
        await emit(run, "subagent_done", { id: subId, role: to, task: message, error: err?.message || String(err), sessionId: run.sessionId });
        await saveTeamState(run);
        return { ok: false, recipient: to, error: err?.message || String(err) };
      }
    },
    onTeamBroadcast: async ({ topic, message }) => {
      const bcObj = { id: `bc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`, type: "broadcast", topic, message, timestamp: new Date().toISOString() };
      run.teamMessages.push(bcObj);
      await emit(run, "team_broadcast", bcObj);
      await saveTeamState(run);
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
  await emit(parent, "subagent_start", { id, role, task, sessionId: parent.sessionId });
  let finalText = "";
  try {
    const result = await runAgentLoop({
      model: parent.request.model,
      messages: [{ role: "user", content: task }],
      systemPrompt: `You are a ${role}. Complete only the delegated task. Do not modify files. Return concise evidence.`,
      apiKey: parent.request.apiKey,
      workspace: parent.workspace,
      sessionId: parent.sessionId,
      accessMode: "sandbox",
      maxSteps: parent.request.maxSteps > 0 ? Math.min(parent.request.maxSteps, 6) : 6,
      signal: parent.abortController.signal,
      depth: 1,
      isRedmineTask: Boolean(parent.projectMeta?.redmineIssueId),
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
    await emit(parent, "subagent_done", { id, role, task, finalText, sessionId: parent.sessionId });
    return { ok: true, id, role, result: finalText };
  } catch (error) {
    sub.status = "failed";
    await emit(parent, "subagent_done", { id, role, task, error: error?.message || String(error), sessionId: parent.sessionId });
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

  const orchestrator = run.teamRoster?.get("orchestrator");
  if (orchestrator) {
    orchestrator.status = "running";
    emit(run, "team_roster_update", { roster: Array.from(run.teamRoster.values()) }).catch(() => {});
  }

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
    
    // Auto-complete any remaining in_progress tasks so board doesn't leave them dangling
    if (!stopped && run.teamTasks) {
      let updatedAny = false;
      for (const t of run.teamTasks.values()) {
        if (t.status === "in_progress") {
          t.status = "completed";
          t.updatedAt = new Date().toISOString();
          updatedAny = true;
        }
      }
      if (updatedAny) {
        const list = Array.from(run.teamTasks.values());
        await emit(run, "team_tasks_update", { tasks: list });
      }
    }

    // Normalize any roster member left in 'running' state so DB doesn't freeze them as running
    if (run.teamRoster) {
      for (const m of run.teamRoster.values()) {
        if (m.status === "running") m.status = stopped ? "idle" : "completed";
      }
    }
    await saveTeamState(run);

    const status = stopped ? "stopped" : "completed";
    run.status = status;
    const result = { messages: run.messages, finalText: content, title, tokenUsage: run.tokenUsage || null };
    await updateChatRunRecord(run.id, { status, result, finishedAt: new Date().toISOString() });
    await emit(run, "done", { ...result, stopped });

    // Redmine Task tracking: if session is linked to Redmine task, determine local status (done vs pending)
    if (!stopped && status === "completed") {
      try {
        const sess = await getChatSession(run.sessionId, { includeMessages: false });
        if (sess?.projectMeta?.redmineIssueId) {
          const rIssueId = String(sess.projectMeta.redmineIssueId);

          const isPending =
            /\[STATUS:\s*PENDING\]/i.test(content) ||
            /(?:status\s*[:=]\s*pending)/i.test(content) ||
            /(?:pending|gagal\s+konek).*database/i.test(content) ||
            /(?:deskripsi|kebutuhan|spesifikasi).*(?:kurang\s+jelas|ambigu|pertanyaan|klarifikasi)/i.test(content) ||
            sess?.projectMeta?.localStatus === "pending";

          const finalLocalStatus = isPending ? "pending" : "done";

          let pendingReason = null;
          if (isPending) {
            if (/(?:pertanyaan|deskripsi|kurang\s+jelas|klarifikasi|butuh\s+konfirmasi|ambigu|tanya)/i.test(content)) {
              pendingReason = "Deskripsi kurang jelas / butuh konfirmasi pertanyaan";
            } else if (/(?:koneksi|database|db|connect)/i.test(content)) {
              pendingReason = "Koneksi database dibutuhkan atau gagal terhubung";
            } else {
              pendingReason = "Memerlukan konfirmasi atau review lebih lanjut";
            }
          }

          await updateChatSession(run.sessionId, {
            projectMeta: {
              ...sess.projectMeta,
              localStatus: finalLocalStatus,
              localStatusReason: pendingReason,
            },
          }).catch(() => {});

          const currentSettings = await getSettings();
          const rts = { ...(currentSettings?.redmineTaskStatuses || {}) };
          rts[rIssueId] = {
            ...(rts[rIssueId] || {}),
            status: finalLocalStatus,
            sessionId: run.sessionId,
            sessionTitle: sess.title,
            finishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reason: isPending ? pendingReason : null,
          };
          await updateSettings({ redmineTaskStatuses: rts }).catch(() => {});

          if (isPending) {
            await emit(run, "notice", {
              message: `Task #${rIssueId} status marked as PENDING in 9Router (${pendingReason}).`,
            }).catch(() => {});
          } else {
            // Auto-commit any remaining uncommitted changes locally (NEVER PUSH)
            try {
              const projectDir = sess.workspacePath || run.workspace;
              if (projectDir) {
                const { execSync } = await import("node:child_process");
                const gitStatus = execSync("git status --porcelain", {
                  cwd: projectDir,
                  encoding: "utf8",
                  stdio: ["ignore", "pipe", "ignore"],
                  timeout: 10000,
                });
                if (gitStatus && gitStatus.trim().length > 0) {
                  const rawSubject = sess.projectMeta.redmineIssueSubject || sess.title || "resolve redmine task";
                  const cleanSubject = String(rawSubject).replace(/[\r\n"\\`$]/g, " ").trim();
                  const commitMsg = `feat(#${rIssueId}): ${cleanSubject}`;
                  execSync("git add -A", { cwd: projectDir, stdio: "ignore", timeout: 15000 });
                  try {
                    execSync(`git commit -m "${commitMsg}"`, { cwd: projectDir, stdio: "ignore", timeout: 15000 });
                  } catch {
                    // Fallback author if no user.name/email set in repo
                    execSync(`git -c user.name="9Router Agent" -c user.email="agent@9router.local" commit -m "${commitMsg}"`, {
                      cwd: projectDir,
                      stdio: "ignore",
                      timeout: 15000,
                    });
                  }
                  await emit(run, "notice", {
                    message: `Task changes automatically committed locally: "${commitMsg}" (remote push skipped as requested).`,
                  }).catch(() => {});
                }
              }
            } catch {
              // Not a git repository or commit error, safely ignore
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Self-Improving AI: background post-turn reflection
    if (!stopped && status === "completed") {
      void runBackgroundReflection(run, content).catch(() => {});
    }
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

    if (run.teamRoster) {
      for (const m of run.teamRoster.values()) {
        if (m.status === "running") m.status = run.abortController.signal.aborted ? "idle" : "failed";
      }
    }
    await saveTeamState(run);

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

  // Clean up and abort any lingering runs for the same session to avoid race conditions
  for (const [existingId, existing] of liveRuns.entries()) {
    if (existing.sessionId === input.sessionId && !existing.abortController?.signal?.aborted) {
      settleGates(existing);
      existing.abortController?.abort();
      existing.status = "stopped";
      liveRuns.delete(existingId);
    }
  }
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

  const existingTeam = session.teamState || {};
  const teamRoster = new Map([
    ["orchestrator", { name: "orchestrator", role: "Team Lead & Captain", description: "Plans DAG tasks, assigns work, synthesizes results", status: "idle" }],
    ["dev", { name: "dev", role: "Implementation Engineer", description: "Writes and updates code, runs tests", status: "idle" }],
    ["qa", { name: "qa", role: "Quality & Security Reviewer", description: "Finds regressions, edge cases, vulnerabilities", status: "idle" }],
    ["architect", { name: "architect", role: "System Architect", description: "Designs architecture, data flow, and boundaries", status: "idle" }],
  ]);
  if (Array.isArray(existingTeam.roster) && existingTeam.roster.length > 0) {
    for (const m of existingTeam.roster) {
      if (m?.name) teamRoster.set(m.name, { ...m, status: "idle" });
    }
  } else if (Array.isArray(input.teamRoster) && input.teamRoster.length > 0) {
    for (const m of input.teamRoster) {
      if (m?.name) teamRoster.set(m.name, { ...m, status: "idle" });
    }
  }

  const teamTasks = new Map();
  if (Array.isArray(existingTeam.tasks) && existingTeam.tasks.length > 0) {
    for (const t of existingTeam.tasks) {
      if (t?.id) teamTasks.set(t.id, t);
    }
  } else if (Array.isArray(input.teamTasks) && input.teamTasks.length > 0) {
    for (const t of input.teamTasks) {
      if (t?.id) teamTasks.set(t.id, t);
    }
  } else if (Array.isArray(session.tasks) && session.tasks.length > 0) {
    session.tasks.forEach((t, idx) => {
      const tid = `task_${idx + 1}`;
      teamTasks.set(tid, {
        id: tid,
        title: t.content || `Task ${idx + 1}`,
        description: t.content || "",
        assignee: "orchestrator",
        status: t.status === "in_progress" ? "in_progress" : t.status === "completed" ? "completed" : "pending",
        dependsOn: idx > 0 ? [`task_${idx}`] : [],
        updatedAt: new Date().toISOString(),
      });
    });
  }
  const teamMessages = Array.isArray(existingTeam.messages) ? [...existingTeam.messages] : [];

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
    projectMeta: session.projectMeta || input.projectMeta || null,
    steering: [],
    tasks: Array.isArray(session.tasks) ? [...session.tasks] : [],
    subAgents: new Map(),
    gates: new Map(),
    teamRoster,
    teamTasks,
    teamMessages,
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
  const isLive = !!live && live.status !== "completed" && live.status !== "stopped" && live.status !== "failed" && !live.abortController?.signal?.aborted;
  const events = live ? live.events.filter((event) => event.seq > Number(after || 0)) : await listChatRunEvents(id, { after });
  return { ...record, status: live?.status || record.status, events, live: isLive, lastSeq: live?.seq || events.at(-1)?.seq || 0 };
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

export function isRunLiveForSession(sessionId) {
  return !!getLiveRunForSession(sessionId);
}

export function getActiveServerRunSessions() {
  const activeSessionIds = [];
  for (const run of liveRuns.values()) {
    if (run.status === "stopped" || run.status === "completed" || run.status === "failed") continue;
    if (run.abortController?.signal?.aborted) continue;
    if (run.sessionId && !activeSessionIds.includes(run.sessionId)) {
      activeSessionIds.push(run.sessionId);
    }
  }
  return activeSessionIds;
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
  let run = liveRuns.get(runId);
  let gate = run?.gates?.get(gateId);
  if (!gate) {
    for (const r of liveRuns.values()) {
      if (r.gates?.has(gateId)) {
        run = r;
        gate = r.gates.get(gateId);
        break;
      }
    }
  }
  if (!run || !gate) return null;
  clearTimeout(gate.timer);
  run.gates.delete(gateId);
  if (gate.kind === "approval") {
    gate.resolve(outcome === "allow");
  } else {
    gate.resolve(String(outcome || ""));
  }
  return { id: run.id, gateId, resolved: true };
}

export function setChatAutoApprove(runId, enabled) {
  let run = liveRuns.get(runId);
  if (!run) {
    for (const r of liveRuns.values()) {
      if (r.id === runId || r.sessionId === runId) {
        run = r;
        break;
      }
    }
  }
  if (!run) return null;
  run.autoApprove = enabled === true;
  if (run.autoApprove && run.gates?.size > 0) {
    for (const [gid, gate] of Array.from(run.gates.entries())) {
      if (gate.kind === "approval") {
        clearTimeout(gate.timer);
        run.gates.delete(gid);
        gate.resolve(true);
      }
    }
  }
  return { id: run.id, autoApprove: run.autoApprove };
}

export function subscribeServerChatRun(id, listener, after = 0) {
  const run = liveRuns.get(id);
  if (!run) return null;
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
