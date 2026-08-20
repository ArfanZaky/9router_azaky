/**
 * Module-level chat runs — multiple sessions can run in parallel. Survives
 * route unmount so streams keep going when user leaves /dashboard/chat.
 * Only explicit Stop aborts a run.
 */

const listeners = new Set();
/** Map sessionId → run state. */
const runs = new Map();
/** The "focused" session (last started/patched); used by legacy getChatRun(). */
let focusedSessionId = null;

/** @typedef {object} ChatRunState
 * @property {string} sessionId
 * @property {string|null|undefined} runId
 * @property {AbortController|null|undefined} abortController
 * @property {any[]} messages
 * @property {string} assistantId
 * @property {string} assistantText
 * @property {boolean} isSending
 * @property {string} agentStatus
 * @property {string} error
 * @property {string} titleSeed
 * @property {object} sessionMeta */

function runFor(sessionId) {
  if (!sessionId) return null;
  return runs.get(sessionId) || null;
}

/** Get a run state. With no argument returns the focused (last-active) run. */
export function getChatRun(sessionId) {
  if (sessionId) return runFor(sessionId);
  return focusedSessionId ? runFor(focusedSessionId) : null;
}

/** List session ids with an active (sending) run. */
export function getActiveRunSessions() {
  return [...runs.values()].filter((r) => r.isSending).map((r) => r.sessionId);
}

export function subscribeChatRun(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(getChatRun());
    } catch {
      // ignore subscriber errors
    }
  }
}

export function startChatRun(snapshot) {
  const state = {
    sessionId: snapshot.sessionId,
    runId: snapshot.runId || null,
    abortController: snapshot.abortController,
    messages: snapshot.messages || [],
    assistantId: snapshot.assistantId,
    assistantText: snapshot.assistantText || "",
    isSending: true,
    agentStatus: snapshot.agentStatus || "",
    error: "",
    titleSeed: snapshot.titleSeed || "",
    sessionMeta: snapshot.sessionMeta || {},
  };
  runs.set(snapshot.sessionId, state);
  focusedSessionId = snapshot.sessionId;
  notify();
  return state;
}

export function patchChatRun(sessionId, patch) {
  if (typeof sessionId === "object") {
    // Backward-compat: patchChatRun(patch) applied to the focused run.
    patch = sessionId;
    sessionId = focusedSessionId;
  }
  const state = runFor(sessionId);
  if (!state) return null;
  const next = { ...state, ...patch };
  if (patch.messages) next.messages = patch.messages;
  runs.set(sessionId, next);
  focusedSessionId = sessionId;
  notify();
  return next;
}

export function abortChatRun(sessionId) {
  const sid = sessionId || focusedSessionId;
  const state = runFor(sid);
  if (!state) return;
  state.abortController?.abort();
  if (state.runId) {
    fetch(`/api/chat/runs/${state.runId}`, { method: "DELETE" }).catch(() => {});
  }
}

export function clearChatRun(sessionId) {
  const sid = sessionId || focusedSessionId;
  if (!sid) return null;
  const state = runFor(sid);
  const snap = state ? { ...state, isSending: false, agentStatus: "", abortController: null } : null;
  runs.delete(sid);
  if (focusedSessionId === sid) focusedSessionId = null;
  notify();
  return snap;
}

export function isRunActiveFor(sessionId) {
  return !!(runFor(sessionId)?.isSending);
}

export async function persistChatMessages(sessionId, messages) {
  if (!sessionId) return;
  await fetch(`/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
}

export async function patchChatSession(sessionId, patch) {
  if (!sessionId) return null;
  const res = await fetch(`/api/chat/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json().catch(() => ({}));
}

/** Build a short stop/finish summary when model left empty text. */
export function buildStopSummary(messages, assistantText, { stopped = false } = {}) {
  const text = (assistantText || "").trim();
  if (text) return text;

  const tools = (messages || []).filter((m) => m.role === "tool");
  const toolNames = tools
    .map((m) => m.name)
    .filter(Boolean)
    .slice(-6);
  const runningLeft = tools.some((m) => m.status === "running");

  if (toolNames.length > 0) {
    const list = [...new Set(toolNames)].join(", ");
    if (stopped) {
      return runningLeft
        ? `(Stopped while running tools: ${list})`
        : `(Stopped after tools: ${list})`;
    }
    return `(Completed tools: ${list})`;
  }

  return stopped ? "(Stopped)" : "(No response)";
}

export function makeSessionTitle(text = "") {
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}
