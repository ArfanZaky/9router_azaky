/**
 * Module-level chat run — survives route unmount so streams keep going
 * when user leaves /dashboard/chat. Only explicit Stop aborts.
 */

const listeners = new Set();

/** @type {null | {
 *   sessionId: string,
 *   runId?: string,
 *   abortController: AbortController,
 *   messages: any[],
 *   assistantId: string,
 *   assistantText: string,
 *   isSending: boolean,
 *   agentStatus: string,
 *   error: string,
 *   titleSeed: string,
 *   sessionMeta: { title?: string, model?: string, providerId?: string },
 * }} */
let active = null;

export function getChatRun() {
  return active;
}

export function subscribeChatRun(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(active);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function startChatRun(snapshot) {
  active = {
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
  notify();
  return active;
}

export function patchChatRun(patch) {
  if (!active) return null;
  active = { ...active, ...patch };
  if (patch.messages) active.messages = patch.messages;
  notify();
  return active;
}

export function abortChatRun() {
  active?.abortController?.abort();
  if (active?.runId) {
    fetch(`/api/chat/runs/${active.runId}`, { method: "DELETE" }).catch(() => {});
  }
}

export function clearChatRun() {
  if (active) {
    active = { ...active, isSending: false, agentStatus: "", abortController: null };
  }
  const snap = active;
  active = null;
  notify();
  return snap;
}

export function isRunActiveFor(sessionId) {
  return !!(active?.isSending && active.sessionId === sessionId);
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
