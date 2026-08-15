"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, ModelSelectModal } from "@/shared/components";
import ChatMarkdown from "./ChatMarkdown";
import ChatToolCard from "./ChatToolCard";
import SlashCommandPalette, { CHAT_COMMANDS, commandMatches } from "./SlashCommandPalette";
import ProjectSidebar from "./ProjectSidebar";
import {
  abortChatRun,
  buildStopSummary,
  clearChatRun,
  getChatRun,
  makeSessionTitle as makeRunTitle,
  patchChatRun,
  patchChatSession as patchRunSession,
  persistChatMessages,
  startChatRun,
  subscribeChatRun,
} from "@/lib/chat/chatRunRuntime";

const AGENT_ROLES = [
  {
    id: "orchestrator",
    label: "Orchestrator",
    icon: "hub",
    description: "Plan, delegate, coordinate",
    prompt: "Act as the lead orchestrator. For multi-step work, publish a todo_update checklist, delegate focused read-only research or review with delegate_task, integrate the results, execute the remaining work, verify it, then report one coherent outcome. Do not delegate trivial work.",
  },
  {
    id: "coder",
    label: "Coder",
    icon: "code",
    description: "Implement and verify",
    prompt: "Act as a senior implementation agent. Inspect the code first, make the smallest correct changes, run relevant verification, then summarize changed files and evidence.",
  },
  {
    id: "researcher",
    label: "Researcher",
    icon: "travel_explore",
    description: "Investigate with evidence",
    prompt: "Act as an evidence-first researcher. Prefer read-only tools and web research. Cite concrete files, symbols, URLs, and uncertainties. Do not modify files unless explicitly requested.",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    icon: "fact_check",
    description: "Find bugs and risks",
    prompt: "Act as a strict code reviewer. Prioritize correctness bugs, security risks, regressions, race conditions, and missing tests. Lead with findings and file references. Do not modify files unless explicitly requested.",
  },
  {
    id: "planner",
    label: "Planner",
    icon: "account_tree",
    description: "Design execution steps",
    prompt: "Act as a technical planner. Inspect current architecture, identify dependencies and risks, then produce an actionable phased plan with acceptance criteria. Do not modify files.",
  },
];

const DEFAULT_PARAMS = {
  temperature: 0.7,
  max_tokens: 4096,
  top_p: 1,
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function makeSessionTitle(text = "") {
  return makeRunTitle(textValue(text));
}

function formatRelativeTime(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function buildUserContent(message) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length === 0) return text;
  const content = [];
  if (text) content.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }
  return content.length > 0 ? content : text;
}

function readAssistantText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

function exportSessionMarkdown(session) {
  const lines = [
    `# ${session.title || "Chat"}`,
    "",
    `- Model: ${session.model || "-"}`,
    `- Updated: ${session.updatedAt || "-"}`,
    "",
  ];
  if (session.systemPrompt) {
    lines.push("## System", "", session.systemPrompt, "");
  }
  for (const msg of session.messages || []) {
    lines.push(`## ${msg.role}`, "", textValue(msg.content), "");
  }
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function SubAgentOverlay({ agent, onClose }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/chat/subagents/${agent.id}`)
        .then((r) => r.json())
        .then((d) => { if (alive && !d.error) setInfo(d); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [agent.id]);

  const textEvents = (info?.events || []).filter((e) => e.type === "text" || e.type === "message");
  const lastText = textEvents.at(-1)?.data?.content || "";
  const reasoning = (info?.events || []).filter((e) => e.type === "reasoning").at(-1)?.data?.content || "";
  const toolCount = (info?.events || []).filter((e) => e.type === "tool_start").length;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Sub-agent transcript">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="material-symbols-outlined text-[20px] text-primary">account_tree</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{agent.role || "Sub-agent"}</p>
            <p className="truncate text-[11px] text-text-muted">{agent.task}</p>
          </div>
          <span className={`text-[11px] ${info?.status === "running" ? "text-primary" : info?.status === "failed" ? "text-red-500" : "text-emerald-500"}`}>
            {info?.status || "running"}
          </span>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><span className="material-symbols-outlined text-[18px]">close</span></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {reasoning ? (
              <details open className="rounded-xl border border-border bg-background/40 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-text-muted">Reasoning</summary>
                <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{reasoning}</div>
              </details>
            ) : null}
            <div className="whitespace-pre-wrap break-words text-sm leading-6">{lastText || "Working…"}</div>
            {toolCount > 0 ? <p className="text-[11px] text-text-muted">{toolCount} tool call{toolCount > 1 ? "s" : ""}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AskWizard({ ask, onAnswer }) {
  const questions = Array.isArray(ask.questions) ? ask.questions.filter((q) => q && q.question) : [];
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [custom, setCustom] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (questions.length === 0) return null;

  const q = questions[idx];
  const isLast = idx === questions.length - 1;
  const multi = !!q.multiSelect;
  const selected = answers[idx] || [];

  const commitCustom = (base) => {
    const v = custom.trim();
    if (!v) return base;
    const cur = base[idx] || [];
    return multi ? { ...base, [idx]: [...cur.filter((x) => x !== v), v] } : { ...base, [idx]: [v] };
  };

  const submit = (final) => {
    const all = final || answers;
    const lines = questions.map((qq, i) => {
      const a = all[i]?.length ? all[i].join(", ") : "(no answer)";
      return `${qq.header || qq.question}: ${a}`;
    });
    setSubmitted(true);
    onAnswer(questions.length === 1 ? (all[0]?.join(", ") || "") : lines.join("\n"));
  };

  const toggleOption = (o) => {
    if (multi) {
      setAnswers((a) => ({ ...a, [idx]: selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o] }));
    } else {
      const next = { ...answers, [idx]: [o] };
      setAnswers(next);
      if (questions.length === 1) submit(next);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
        <p className="text-[11px] text-text-muted">Answered ✓</p>
      </div>
    );
  }

  const hasOptions = (q.options || []).length > 0;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="material-symbols-outlined text-[20px] text-primary">help</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {q.header ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">{q.header}</span>
            ) : null}
            {questions.length > 1 ? (
              <span className="text-[11px] text-text-muted">{idx + 1}/{questions.length}</span>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm font-medium">{q.question}</p>

          {hasOptions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.options.map((o) => (
                <Button
                  key={o}
                  size="sm"
                  variant={selected.includes(o) ? "secondary" : "outline"}
                  onClick={() => toggleOption(o)}
                >
                  {o}
                </Button>
              ))}
            </div>
          ) : null}

          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={hasOptions ? "Or type your own…" : "Type your answer…"}
            className="mt-2.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isLast) submit(commitCustom(answers));
                else {
                  setAnswers(commitCustom(answers));
                  setCustom("");
                  setIdx((i) => Math.min(questions.length - 1, i + 1));
                }
              }
            }}
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              Prev
            </Button>
            {isLast ? (
              <Button size="sm" onClick={() => submit(commitCustom(answers))}>Submit</Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setAnswers(commitCustom(answers));
                  setCustom("");
                  setIdx((i) => Math.min(questions.length - 1, i + 1));
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPageClient() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [renameId, setRenameId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [agentRole, setAgentRole] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("chat.agentRole") || "orchestrator";
    } catch {
      return "orchestrator";
    }
  });
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  /** full = bash+write; sandbox = read-only host + web/image */
  const [accessMode, setAccessMode] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("chat.accessMode") === "full" ? "full" : "sandbox";
    } catch {
      return "sandbox";
    }
  });
  /** raw = show tool cards; chat = hide tool UI (still runs tools if agent) */
  const [viewMode, setViewMode] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("chat.viewMode") === "chat" ? "chat" : "raw";
    } catch {
      return "raw";
    }
  });
  const [imagePreview, setImagePreview] = useState(null); // { src, name }
  const [showReasoning, setShowReasoning] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("chat.reasoningEffort") || "";
    } catch {
      return "";
    }
  });
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [maxSteps, setMaxSteps] = useState(() => {
    try {
      const v = Number(globalThis.localStorage?.getItem("chat.maxSteps"));
      return Number.isFinite(v) && v >= 0 && v <= 1000 ? v : 0;
    } catch {
      return 0;
    }
  });
  const [tasks, setTasks] = useState([]);
  const [subAgents, setSubAgents] = useState([]);
  const [viewingAgent, setViewingAgent] = useState(null);
  const [liveInfo, setLiveInfo] = useState({ turn: 0, tool: null, waiting: false, notice: "", elapsed: 0 });
  const [approvals, setApprovals] = useState([]);
  const [asks, setAsks] = useState([]);
  const [projectOpen, setProjectOpen] = useState(true);
  const [projectInfo, setProjectInfo] = useState(null);
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [pendingProject, setPendingProject] = useState(null);
  const [codebase, setCodebase] = useState("");
  const [codebaseEdit, setCodebaseEdit] = useState(false);
  const [codebaseValue, setCodebaseValue] = useState("");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionModalMode, setSessionModalMode] = useState("create"); // create | edit
  const [sessionFormName, setSessionFormName] = useState("");
  const [sessionFormUrl, setSessionFormUrl] = useState("");
  const [sessionFormEditId, setSessionFormEditId] = useState("");
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: "", url: "", transport: "sse", command: "", args: "" });
  const [mcpProbe, setMcpProbe] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [ctxUsed, setCtxUsed] = useState(0);
  const [ctxWindow, setCtxWindow] = useState(0);
  const [windowIndex, setWindowIndex] = useState(-1);
  const [verifyMode, setVerifyMode] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [inputHistory, setInputHistory] = useState(() => {
    try {
      const raw = globalThis.localStorage?.getItem("chat.inputHistory");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 50) : [];
    } catch {
      return [];
    }
  });
  const [historyPos, setHistoryPos] = useState(-1);
  const draftRefForHistory = useRef("");

  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const activeSessionIdRef = useRef(activeSessionId);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const websocketRef = useRef(new Map()); // runId → WebSocket
  const reconnectTimerRef = useRef(new Map()); // runId → timer
  const liveRunRef = useRef(new Map()); // runId → live run context

  // Transport callbacks need the latest session without reconnecting on every selection.
  // eslint-disable-next-line react-hooks/refs
  activeSessionIdRef.current = activeSessionId;

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.agentRole", agentRole);
    } catch {
      // ignore
    }
  }, [agentRole]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.accessMode", accessMode);
    } catch {
      // ignore
    }
  }, [accessMode]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.maxSteps", String(maxSteps));
    } catch {
      // ignore
    }
  }, [maxSteps]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.viewMode", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.reasoningEffort", reasoningEffort);
    } catch {
      // ignore
    }
  }, [reasoningEffort]);

  useEffect(() => {
    if (!imagePreview) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setImagePreview(null);
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, [imagePreview]);

  const visibleMessages = useMemo(() => {
    const embeddedTools = new Set(messages.flatMap((m) => (m.segments || []).filter((segment) => segment.type === "tool").map((segment) => segment.callId)));
    return messages.filter((m) => m.role !== "tool" || (viewMode === "raw" && !embeddedTools.has(m.tool_call_id)));
  }, [messages, viewMode]);

  // Windowing for very long transcripts: render a ±50 window around an anchor
  // index. windowIndex stays -1 (render all) until the list passes 120 messages.
  const WINDOW = 50;
  const windowed = useMemo(() => {
    if (visibleMessages.length <= 120 || windowIndex < 0) return { list: visibleMessages, start: 0, end: visibleMessages.length };
    const start = Math.max(0, windowIndex - WINDOW);
    const end = Math.min(visibleMessages.length, windowIndex + WINDOW + 1);
    return { list: visibleMessages.slice(start, end), start, end };
  }, [visibleMessages, windowIndex]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s.title || "").toLowerCase().includes(q) ||
        (s.model || "").toLowerCase().includes(q)
    );
  }, [sessions, search]);

  const params = { ...DEFAULT_PARAMS, ...(activeSession?.params || {}) };
  const canSend =
    !isSending &&
    !!activeSession?.model &&
    !!apiKey &&
    (draft.trim().length > 0 || attachments.length > 0);
  const commandOptions = useMemo(() => commandMatches(draft), [draft]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleTranscriptScroll = useCallback((event) => {
    const el = event.currentTarget;
    if (visibleMessages.length <= 120) return;
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const rows = Array.from(el.querySelectorAll("[data-chat-message-index]"));
    let best = -1;
    let bestDist = Infinity;
    for (const row of rows) {
      const index = Number(row.getAttribute("data-chat-message-index") || -1);
      const r = row.getBoundingClientRect();
      const dist = Math.abs(r.top + r.height / 2 - midY);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    }
    if (best >= 0) setWindowIndex(best);
  }, [visibleMessages.length]);

  const loadSessions = useCallback(async (preferId) => {
    const res = await fetch("/api/chat/sessions?limit=200");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load sessions");
    const list = data.sessions || [];
    setSessions(list);
    const nextId = preferId || activeSessionId || list[0]?.id || "";
    if (nextId) setActiveSessionId(nextId);
    return list;
  }, [activeSessionId]);

  const loadSessionDetail = useCallback(async (id) => {
    if (!id) {
      setMessages([]);
      return null;
    }
    const res = await fetch(`/api/chat/sessions/${id}?limit=1000`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load session");
    setMessages(data.messages || []);
    setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    if (data.codebase) setCodebase(data.codebase);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...data, messages: undefined } : s))
    );
    return data;
  }, []);

  // Keep stream alive across menu navigation — only explicit Stop aborts.
  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeChatRun((run) => {
      if (!mountedRef.current) return;
      if (!run) {
        setIsSending(false);
        setAgentStatus("");
        return;
      }
      if (run.sessionId !== activeSessionIdRef.current) return;
      setMessages(run.messages || []);
      setIsSending(!!run.isSending);
      setAgentStatus(run.agentStatus || "");
      if (run.error) setError(run.error);
    });
    // Reattach transport if a server run is still active after remount.
    const existing = getChatRun();
    if (existing?.isSending && existing.runId) {
      const existingSessionId = existing.sessionId;
      if (!liveRunRef.current.get(existing.runId)) {
        let lastSeq = 0;
        const liveCtx = {
          runId: existing.runId,
          lastSeq: () => lastSeq,
          isActive: () => !!getChatRun(existingSessionId)?.isSending,
          applyEvent: (event) => {
            if (!event || event.seq <= lastSeq) return;
            lastSeq = event.seq;
            const data = event.data || {};
            if (event.type === "text" || (event.type === "message" && data.role === "assistant")) {
              const content = data.content || existing.assistantText || "";
              patchChatRun(existingSessionId, {
                assistantText: content,
                messages: (getChatRun(existingSessionId)?.messages || []).map((m) =>
                  m.id === existing.assistantId
                    ? {
                        ...m,
                        content,
                        tool_calls: data.tool_calls || m.tool_calls || null,
                        status: data.tool_calls?.length ? "tool_calls" : "streaming",
                      }
                    : m
                ),
              });
            } else if (event.type === "status") {
              const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
              const detail =
                data.phase === "thinking"
                  ? `thinking (step ${data.step || "?"})`
                  : data.phase === "init"
                    ? `workspace ${data.workspace || "…"}`
                    : data.phase || "working";
              patchChatRun(existingSessionId, { agentStatus: `${roleLabel} ${detail}…` });
            } else if (event.type === "reasoning") {
              const reasoning = data.content || "";
              patchChatRun(existingSessionId, {
                messages: (getChatRun(existingSessionId)?.messages || []).map((m) => m.id === existing.assistantId
                  ? { ...m, reasoning, segments: [...(m.segments || []).filter((s) => s.type !== "reasoning"), { type: "reasoning", content: reasoning }] }
                  : m),
              });
            } else if (event.type === "usage") {
              const used = Number(data.context_tokens || 0);
              const win = Number(data.context_window || 0);
              if (used > 0) setCtxUsed(used);
              if (win > 0) setCtxWindow(win);
            } else if (event.type === "task_update") {
              setTasks(data.items || []);
            } else if (event.type === "approval") {
              setApprovals((prev) => [...prev.filter((item) => item.id !== data.id), data]);
              setAgentStatus(`Waiting for approval: ${data.tool || "tool"}`);
            } else if (event.type === "ask") {
              setAsks((prev) => [...prev.filter((item) => item.id !== data.id), data]);
              setAgentStatus("Waiting for your answer…");
            } else if (event.type === "subagent_start") {
              setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), { ...data, status: "running" }]);
            } else if (event.type === "subagent_done") {
              setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data, status: data.error ? "failed" : "completed" } : item));
            } else if (event.type === "tool_start" || event.type === "tool_result") {
              // Reload session messages on tool boundaries after remount.
              loadSessionDetail(existingSessionId).catch(() => {});
              patchChatRun(existingSessionId, {
                agentStatus:
                  event.type === "tool_start"
                    ? `Tool: ${data.name}…`
                    : `Tool done: ${data.name}`,
              });
            } else if (event.type === "tool_progress") {
              patchChatRun(existingSessionId, {
                messages: (getChatRun(existingSessionId)?.messages || []).map((m) => m.id === existing.assistantId
                  ? { ...m, segments: (m.segments || []).map((segment) => segment.type === "tool" && segment.callId === data.id ? { ...segment, progress: (segment.progress || "") + (data.chunk || "") } : segment) }
                  : m),
              });
            } else if (event.type === "done" || event.type === "error") {
              const finalMessages = data.messages || getChatRun(existingSessionId)?.messages || [];
              patchChatRun(existingSessionId, {
                messages: finalMessages,
                assistantText: data.finalText || data.message || "",
                isSending: false,
                agentStatus: "",
                error: event.type === "error" ? data.message || "Chat failed" : "",
              });
              clearChatRun(existingSessionId);
              // eslint-disable-next-line react-hooks/immutability
              stopRunTransport(existing.runId);
              liveRunRef.current.delete(existing.runId);
              setApprovals([]);
              setAsks([]);
              if (mountedRef.current && activeSessionIdRef.current === existing.sessionId) {
                setMessages(finalMessages);
                setIsSending(false);
                setAgentStatus("");
                if (event.type === "error") setError(data.message || "Chat failed");
              }
            }
          },
        };
        liveRunRef.current.set(existing.runId, liveCtx);
      }
      // eslint-disable-next-line react-hooks/immutability
      connectRunSocket(existing.runId, 0, liveRunRef.current.get(existing.runId));
    }
    return () => {
      mountedRef.current = false;
      unsub();
      // do NOT abort — chat continues in background; transport reattaches on remount
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [keysRes, providersRes, aliasesRes, modelsRes] = await Promise.all([
          fetch("/api/keys"),
          fetch("/api/providers"),
          fetch("/api/models/alias").catch(() => null),
          fetch("/api/models").catch(() => null),
        ]);
        const keysData = await keysRes.json().catch(() => ({}));
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = aliasesRes ? await aliasesRes.json().catch(() => ({})) : {};
        const modelsData = modelsRes ? await modelsRes.json().catch(() => ({})) : {};
        if (cancelled) return;
        setApiKey((keysData.keys || []).find((k) => k.isActive !== false)?.key || "");
        setActiveProviders(providersData.connections || []);
        setModelAliases(aliasesData.aliases || {});
        const ctxWin = Number(modelsData?.context_window || 0) || Number(modelsData?.models?.[0]?.context_window || 0);
        if (ctxWin > 0) setCtxWindow(ctxWin);
        let list = await loadSessions();
        if (!cancelled && list.length === 0) {
          const res = await fetch("/api/chat/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "New chat", params: DEFAULT_PARAMS }),
          });
          const created = await res.json().catch(() => null);
          if (created?.id) {
            list = [created];
            setSessions(list);
            setActiveSessionId(created.id);
          }
        }
        const preferRun = getChatRun();
        const bootId = preferRun?.sessionId || list[0]?.id;
        fetch("/api/chat/mcp").then((r) => r.json()).then((d) => { if (!cancelled && d.servers) setMcpServers(d.servers); }).catch(() => {});
        if (!cancelled && bootId) {
          setActiveSessionId(bootId);
          if (preferRun?.isSending && preferRun.sessionId === bootId) {
            setMessages(preferRun.messages || []);
            setIsSending(true);
            setAgentStatus(preferRun.agentStatus || "");
          } else {
            await loadSessionDetail(bootId);
          }
        }
      } catch (e) {
        if (!cancelled) setError(textValue(e.message) || "Failed to init chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Fallback status pulse: keep the agent status visible even when a model
    // call is silent for a while (non-stream reasoning, long tool runs).
    const id = setInterval(() => {
      const run = getChatRun(activeSessionId);
      if (run?.isSending && !agentStatus) {
        const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
        setAgentStatus(`${roleLabel} running…`);
      }
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed-seconds ticker for the streaming indicator while a run is sending.
  useEffect(() => {
    if (!isSending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveInfo((s) => ({ ...s, elapsed: 0 }));
      return undefined;
    }
    const id = setInterval(() => {
      setLiveInfo((s) => ({ ...s, elapsed: s.elapsed + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [isSending]);

  useEffect(() => {
    if (!activeSessionId) return;
    const run = getChatRun(activeSessionId);
    if (run?.isSending && run.sessionId === activeSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(run.messages || []);
      setIsSending(true);
      setAgentStatus(run.agentStatus || "");
      return;
    }
    // Other session (or idle): don't show Stop for a background run elsewhere
    setIsSending(false);
    setAgentStatus("");
    loadSessionDetail(activeSessionId).catch((e) => setError(textValue(e.message)));
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const workspacePath = activeSession?.workspacePath;
    if (!workspacePath) {
      return;
    }
    fetch("/api/chat/projects/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workspacePath }),
    }).then((res) => res.json()).then(setProjectInfo).catch(() => setProjectInfo(null));
  }, [activeSession?.workspacePath]);

  useEffect(() => {
    // Keep the streaming tail in view; when windowed, anchor the window to the end.
    if (visibleMessages.length > 120) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWindowIndex(visibleMessages.length - 1);
    }
    scrollToBottom();
  }, [messages, isSending, scrollToBottom, visibleMessages.length]);

  const patchSession = async (id, patch) => {
    const res = await fetch(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to update session");
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    return data;
  };

  const openCreateModal = () => {
    setSessionModalMode("create");
    setSessionFormName("");
    setSessionFormUrl("");
    setSessionFormEditId("");
    setSessionModalOpen(true);
  };

  const resolveAnalyze = (analyze) => {
    const proj = pendingProject;
    setPendingProject(null);
    if (!proj) return;
    if (analyze) {
      setDraft("Analyze this project: structure, stack, scripts, and how to run it.");
      sendMessage();
    }
  };

  const openEditModal = (session) => {
    setSessionModalMode("edit");
    setSessionFormName(session.title || "");
    setSessionFormUrl(session.codebase || "");
    setSessionFormEditId(session.id);
    setSessionModalOpen(true);
  };

  const saveSessionModal = async () => {
    const name = sessionFormName.trim();
    const url = sessionFormUrl.trim();
    // If the URL looks like a local folder path, resolve it into a project workspace
    // (so the agent runs `cd`/tools inside it, not the 9Router root).
    let workspacePath = "";
    let projectMeta = {};
    const isLocalPath = /^[A-Za-z]:[\\/]|^[\\/]|^\.\.?[\\/]/i.test(url);
    if (url && isLocalPath) {
      try {
        const insp = await fetch("/api/chat/projects/inspect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: url }),
        });
        const inspData = await insp.json().catch(() => ({}));
        if (insp.ok && inspData.workspacePath) {
          workspacePath = inspData.workspacePath;
          projectMeta = { name: inspData.name, packageName: inspData.packageName };
        }
      } catch {
        // ignore — keep codebase-only if inspect fails
      }
    }
    try {
      if (sessionModalMode === "edit" && sessionFormEditId) {
        await patchSession(sessionFormEditId, { title: name || "New chat", codebase: url, workspacePath, projectMeta });
        setCodebase(url);
        setSessions((prev) => prev.map((s) => s.id === sessionFormEditId ? { ...s, title: name || "New chat", codebase: url, workspacePath, projectMeta } : s));
        if (workspacePath) { setProjectInfo({ workspacePath, name: projectMeta.name, scripts: {}, packageName: projectMeta.packageName }); setProjectOpen(true); }
      } else {
        const res = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: name || "New chat",
            model: activeSession?.model || "",
            providerId: activeSession?.providerId || "",
            systemPrompt: activeSession?.systemPrompt || "",
            params: activeSession?.params || DEFAULT_PARAMS,
            codebase: url,
            workspacePath,
            projectMeta,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to create session");
        setSessions((prev) => [data, ...prev]);
        setActiveSessionId(data.id);
        setCodebase(url);
        setMessages([]);
        setDraft("");
        setAttachments([]);
        setTasks([]);
      }
      setSessionModalOpen(false);
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleNewChat = async () => {
    try {
      setError("");
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New chat",
          model: activeSession?.model || "",
          providerId: activeSession?.providerId || "",
          systemPrompt: activeSession?.systemPrompt || "",
          params: activeSession?.params || DEFAULT_PARAMS,
          codebase: codebase || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create session");
      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      setMessages([]);
      setDraft("");
      setAttachments([]);
      setTasks([]);
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleSelectSession = (id) => {
    if (id === activeSessionId) return;
    setActiveSessionId(id);
    setDraft("");
    setAttachments([]);
    setTasks([]);
    setSubAgents([]);
    setError("");
  };

  const handleDeleteSession = async (id) => {
    try {
      const res = await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      const next = sessions.filter((s) => s.id !== id);
      setSessions(next);
      if (activeSessionId === id) {
        const fallback = next[0]?.id || "";
        setActiveSessionId(fallback);
        if (!fallback) setMessages([]);
      }
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleRename = async (id) => {
    const title = renameValue.trim();
    if (!title) return;
    try {
      await patchSession(id, { title });
      setRenameId("");
      setRenameValue("");
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleTogglePin = async (session) => {
    try {
      await patchSession(session.id, { pinned: !session.pinned });
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleSelectModel = async (model) => {
    const value = model?.value || model?.name || "";
    if (!value || !activeSessionId) return;
    const providerId = value.includes("/") ? value.split("/")[0] : "";
    try {
      await patchSession(activeSessionId, { model: value, providerId });
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleParamsChange = async (key, raw) => {
    if (!activeSessionId) return;
    let value = raw;
    if (key === "temperature" || key === "top_p") value = Number(raw);
    if (key === "max_tokens") value = Math.max(1, Number(raw) || 1);
    const next = { ...params, [key]: value };
    try {
      await patchSession(activeSessionId, { params: next });
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const addImageFiles = async (files) => {
    const images = Array.from(files || []).filter((f) => f.type?.startsWith("image/"));
    if (images.length === 0) return;
    const converted = await Promise.all(
      images.map(async (file) => ({
        id: createId(),
        name: file.name || `paste-${Date.now()}.png`,
        type: file.type || "image/png",
        size: file.size || 0,
        dataUrl: await fileToDataUrl(file),
      }))
    );
    setAttachments((prev) => [...prev, ...converted]);
  };

  const addDocFiles = async (files) => {
    const docs = Array.from(files || []).filter((f) => !f.type?.startsWith("image/"));
    if (docs.length === 0) return;
    for (const file of docs.slice(0, 8)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        const res = await fetch("/api/chat/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, data: dataUrl }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
        setAttachments((prev) => [
          ...prev,
          { id: createId(), name: data.name || file.name, type: file.type || "application/octet-stream", size: file.size || 0, docPath: data.path },
        ].slice(0, 8));
      } catch (e) {
        setError(textValue(e.message));
      }
    }
  };

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await addImageFiles(files);
    await addDocFiles(files);
  };

  const handleComposerPaste = async (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageItems = items.filter((it) => it.type?.startsWith("image/"));
    if (imageItems.length === 0) return;
    event.preventDefault();
    const files = imageItems.map((it) => it.getAsFile()).filter(Boolean);
    await addImageFiles(files);
  };

  const handleComposerDrop = async (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    const images = files.filter((f) => f.type?.startsWith("image/"));
    const others = files.filter((f) => !f.type?.startsWith("image/"));
    if (images.length === 0 && others.length === 0) return;
    event.preventDefault();
    await addImageFiles(images);
    await addDocFiles(others);
  };

  const persistMessages = async (sessionId, nextMessages) => {
    await persistChatMessages(sessionId, nextMessages);
  };

  const handleStop = () => {
    abortChatRun(activeSessionId);
    abortRef.current?.abort();
  };

  const stopRunTransport = (runId) => {
    if (runId) {
      const timer = reconnectTimerRef.current.get(runId);
      if (timer) { clearTimeout(timer); reconnectTimerRef.current.delete(runId); }
      const socket = websocketRef.current.get(runId);
      if (socket) {
        try { socket.onclose = null; socket.onerror = null; socket.close(); } catch { /* ignore */ }
        websocketRef.current.delete(runId);
      }
      return;
    }
    // Stop all transports (full teardown).
    for (const timer of reconnectTimerRef.current.values()) clearTimeout(timer);
    reconnectTimerRef.current.clear();
    for (const socket of websocketRef.current.values()) {
      try { socket.onclose = null; socket.onerror = null; socket.close(); } catch { /* ignore */ }
    }
    websocketRef.current.clear();
  };

  const connectRunSocket = (runId, after = 0, ctx = null) => {
    if (!runId || typeof WebSocket === "undefined") return;
    // Do NOT close other runs' sockets — each active run keeps its own WS.
    stopRunTransport(runId);
    const protocol = globalThis.location?.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${globalThis.location.host}/api/chat/ws`);
    websocketRef.current.set(runId, socket);
    const live = ctx || liveRunRef.current.get(runId);
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "subscribe", runId, after }));
    };
    socket.onmessage = (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      if (payload.type === "snapshot" && payload.run?.events) {
        for (const event of payload.run.events) live?.applyEvent(event);
        return;
      }
      const event = payload.type === "event" ? payload.event : null;
      if (!event || !live || live.runId !== runId) return;
      live.applyEvent(event);
    };
    socket.onclose = () => {
      if (live && live.isActive()) {
        const timer = setTimeout(
          () => connectRunSocket(runId, live.lastSeq?.() || 0, live),
          1000
        );
        reconnectTimerRef.current.set(runId, timer);
      }
    };
  };

  const applyUiIfActive = (sessionId, fn) => {
    if (!mountedRef.current) return;
    if (activeSessionIdRef.current !== sessionId) return;
    fn();
  };

  // Keep the live streaming indicator in sync with run events.
  const updateLiveFromEvent = (event, data) => {
    if (event.type === "status") {
      setLiveInfo((s) => ({ ...s, turn: Number(data.step) || s.turn, notice: "", waiting: false }));
    } else if (event.type === "tool_start") {
      setLiveInfo((s) => ({ ...s, tool: data.name || null, waiting: false, notice: "" }));
    } else if (event.type === "tool_result") {
      setLiveInfo((s) => ({ ...s, tool: null, notice: "" }));
    } else if (event.type === "ask") {
      setLiveInfo((s) => ({ ...s, waiting: true, tool: null }));
    } else if (event.type === "approval") {
      setLiveInfo((s) => ({ ...s, waiting: true, tool: data.tool || null }));
    } else if (event.type === "notice") {
      setLiveInfo((s) => ({ ...s, notice: data.message || "" }));
    } else if (event.type === "done" || event.type === "error") {
      setLiveInfo({ turn: 0, tool: null, waiting: false, notice: "", elapsed: 0 });
    }
  };

  const finalizeRun = async ({
    sessionId,
    sessionMeta,
    titleSeed,
    assistantId,
    liveMessages,
    assistantText,
    tokenUsage = null,
    stopped = false,
    errorText = "",
  }) => {
    const summary = errorText
      ? errorText
      : buildStopSummary(liveMessages, assistantText, { stopped });
    const finalMessages = liveMessages.map((m) => {
      if (m.id === assistantId) {
        return {
          ...m,
          content: summary,
          status: errorText ? "error" : "done",
          error: errorText || undefined,
          tokenUsage: tokenUsage || m.tokenUsage,
        };
      }
      if (m.role === "tool" && m.status === "running") {
        return {
          ...m,
          status: "done",
          content: stopped ? `${textValue(m.content) || ""}${textValue(m.content) ? "\n" : ""}(stopped)`.trim() : m.content,
        };
      }
      return m;
    });

    const title =
      sessionMeta?.title === "New chat" || !sessionMeta?.title
        ? makeSessionTitle(titleSeed)
        : sessionMeta.title;

    await patchRunSession(sessionId, {
      title,
      model: sessionMeta?.model,
      providerId: sessionMeta?.providerId,
    }).catch(() => {});
    await persistChatMessages(sessionId, finalMessages).catch(() => {});

    patchChatRun(sessionId, {
      messages: finalMessages,
      assistantText: summary,
      isSending: false,
      agentStatus: "",
      error: errorText || "",
    });
    clearChatRun(sessionId);

    // session list always refresh; transcript only if viewing this session
    if (mountedRef.current) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s
        )
      );
    }
    setProjectRefresh((n) => n + 1);
    applyUiIfActive(sessionId, () => {
      setMessages(finalMessages);
      setIsSending(false);
      setAgentStatus("");
      if (errorText) setError(errorText);
    });
    setApprovals([]);
    setAsks([]);

    return finalMessages;
  };

  const sendMessage = async ({ regenerate = false, sourceMessages = null } = {}) => {
    if (!activeSession?.model) {
      setError("Select a model first.");
      return;
    }
    if (!apiKey) {
      setError("No API key. Create one in Endpoint & Key.");
      return;
    }
    if (getChatRun(activeSessionId)?.isSending) {
      setError("This session is already running. Stop it first or wait.");
      return;
    }

    const sessionId = activeSessionId;
    const sessionMeta = {
      title: activeSession.title,
      model: activeSession.model,
      providerId: activeSession.providerId,
    };

    let workingMessages = [...(sourceMessages || messages)];
    if (regenerate) {
      const lastUserIdx = [...workingMessages].map((m) => m.role).lastIndexOf("user");
      if (lastUserIdx < 0) return;
      workingMessages = workingMessages.slice(0, lastUserIdx + 1);
    } else {
      const userText = draft.trim();
      if (!userText && attachments.length === 0) return;
      const docList = attachments.filter((a) => a.docPath);
      let content = userText;
      if (docList.length > 0) {
        const note = docList.map((d) => `- ${d.name} (path: ${d.docPath})`).join("\n");
        content = content ? `${content}\n\nAttached file(s) — read each with the read_document tool before answering:\n${note}` : `Attached file(s) — read each with the read_document tool before answering:\n${note}`;
      }
      const userMessage = {
        id: createId(),
        role: "user",
        content,
        attachments: attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          dataUrl: a.dataUrl,
          docPath: a.docPath,
        })),
        status: "done",
        createdAt: new Date().toISOString(),
      };
      workingMessages = [...workingMessages, userMessage];
      setDraft("");
      setAttachments([]);
      if (userText) {
        setInputHistory((prev) => {
          const next = prev[0] === userText ? prev : [userText, ...prev.filter((x) => x !== userText)].slice(0, 50);
          try {
            globalThis.localStorage?.setItem("chat.inputHistory", JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      }
      setHistoryPos(-1);
      draftRefForHistory.current = "";
    }

    const assistantId = createId();
    const assistantMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    };
    workingMessages = [...workingMessages, assistantMessage];
    setMessages(workingMessages);
    setIsSending(true);
    setError("");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const titleSeed = textValue(
      workingMessages.find((m) => m.role === "user")?.content || activeSession.title
    );

    startChatRun({
      sessionId,
      abortController: abortRef.current,
      messages: workingMessages,
      assistantId,
      assistantText: "",
      agentStatus: `${AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Agent"} starting…`,
      titleSeed,
      sessionMeta,
    });

    // Build request history. Agent loop sanitizes tool pairing again server-side.
    // Client-side: drop orphan tool rows early so plain chat path is clean too.
    const requestMessages = [];
    const pending = [];
    for (const msg of workingMessages) {
      if (msg.id === assistantId) continue;
      if (msg.role === "tool") {
        pending.push({
          role: "tool",
          tool_call_id: msg.tool_call_id || null,
          id: msg.id,
          content: textValue(msg.content),
          name: msg.name || null,
        });
        continue;
      }
      if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "system") continue;
      const entry = {
        role: msg.role,
        content: msg.role === "user" ? buildUserContent(msg) : textValue(msg.content),
      };
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        entry.tool_calls = msg.tool_calls;
      }
      pending.push(entry);
    }
    // Pair tools only with preceding assistant.tool_calls ids
    {
      let openIds = new Set();
      for (const msg of pending) {
        if (msg.role === "assistant") {
          openIds = new Set(
            (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((tc) => tc.id).filter(Boolean)
          );
          requestMessages.push(msg);
          continue;
        }
        if (msg.role === "tool") {
          const callId = msg.tool_call_id;
          if (callId && openIds.has(callId)) {
            requestMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: msg.content,
            });
            openIds.delete(callId);
          }
          // else drop orphan
          continue;
        }
        openIds = new Set();
        requestMessages.push(msg);
      }
    }

    let assistantText = "";
    let liveMessages = workingMessages;
    let currentRunId = null;

    const pushLive = (next, statusText) => {
      liveMessages = next;
      patchChatRun(sessionId, {
        messages: next,
        assistantText,
        agentStatus: statusText ?? getChatRun(sessionId)?.agentStatus ?? "",
      });
      applyUiIfActive(sessionId, () => {
        setMessages(next);
        if (statusText != null) setAgentStatus(statusText);
      });
    };

    const finalizeServerEvent = (data, isError = false) => {
      const finalMessages = data.messages || liveMessages;
      const finalText = data.finalText || assistantText || (isError ? data.message : "") || "";
      const title =
        sessionMeta?.title === "New chat" || !sessionMeta?.title
          ? makeSessionTitle(titleSeed)
          : sessionMeta.title;
      patchChatRun(sessionId, {
        messages: finalMessages,
        assistantText: finalText,
        isSending: false,
        agentStatus: "",
        error: isError ? data.message || "Chat failed" : "",
      });
      clearChatRun(sessionId);
      if (currentRunId) liveRunRef.current.delete(currentRunId);
      setApprovals([]);
      setAsks([]);
      stopRunTransport(currentRunId || undefined);
      if (mountedRef.current) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId ? { ...s, title: data.title || title, updatedAt: new Date().toISOString() } : s
          )
        );
      }
      applyUiIfActive(sessionId, () => {
        setMessages(finalMessages);
        setIsSending(false);
        setAgentStatus("");
        if (isError) setError(data.message || "Chat failed");
      });
    };

    try {
      applyUiIfActive(sessionId, () => setAgentStatus(`${AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Agent"} starting…`));
      const response = await fetch("/api/chat/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          mode: "agent",
          providerId: sessionMeta.providerId,
          assistantId,
          titleSeed,
          persistedMessages: workingMessages,
          model: activeSession.model,
          messages: requestMessages,
          systemPrompt: [
            AGENT_ROLES.find((role) => role.id === agentRole)?.prompt || "",
            activeSession.systemPrompt || "",
          ].filter(Boolean).join("\n\n"),
          apiKey,
          accessMode,
          verify: verifyMode,
          codebase: codebase || activeSession?.codebase || "",
          autoApprove,
          params: {
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            top_p: params.top_p,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          },
          maxSteps,
        }),
      });
      const started = await response.json().catch(() => ({}));
      if (!response.ok || !started.id) {
        throw new Error(started.error || "Unable to start background chat");
      }
      if (abortRef.current.signal.aborted) {
        await fetch(`/api/chat/runs/${started.id}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      patchChatRun(sessionId, { runId: started.id, agentStatus: `${AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Agent"} running…` });
      currentRunId = started.id;
      let lastSeq = 0;
      const liveCtx = {
        runId: started.id,
        lastSeq: () => lastSeq,
        isActive: () => !!getChatRun(sessionId)?.isSending,
        applyEvent: (event) => {
          if (!event || event.seq <= lastSeq) return;
          lastSeq = event.seq;
          const data = event.data || {};
          updateLiveFromEvent(event, data);
          if (event.type === "text") {
            assistantText = data.content || assistantText;
            pushLive(
              liveMessages.map((m) =>
                m.id === assistantId ? (() => {
                  const segments = [...(m.segments || [])];
                  const last = segments.at(-1);
                  if (last?.type === "text") last.content = assistantText;
                  else segments.push({ type: "text", content: assistantText });
                  return { ...m, content: assistantText, segments, status: "streaming" };
                })() : m
              )
            );
          } else if (event.type === "reasoning") {
            const reasoning = data.content || "";
            pushLive(liveMessages.map((m) => {
              if (m.id !== assistantId) return m;
              const segments = [...(m.segments || [])];
              const last = segments.at(-1);
              if (last?.type === "reasoning") last.content = reasoning;
              else segments.push({ type: "reasoning", content: reasoning });
              return { ...m, reasoning, segments };
            }));
          } else if (event.type === "message" && data.role === "assistant") {
            assistantText = data.content || assistantText;
            pushLive(
              liveMessages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: assistantText,
                      tool_calls: data.tool_calls || null,
                      status: data.tool_calls?.length ? "tool_calls" : "streaming",
                    }
                  : m
              )
            );
          } else if (event.type === "status") {
            const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
            const detail =
              data.phase === "thinking"
                ? `thinking (step ${data.step || "?"})`
                : data.phase === "init"
                  ? `workspace ${data.workspace || "…"}`
                  : data.phase || "working";
            pushLive(liveMessages, `${roleLabel} ${detail}…`);
          } else if (event.type === "tool_start") {
            pushLive(liveMessages.map((m) => m.id === assistantId
              ? { ...m, segments: [...(m.segments || []), { type: "tool", callId: data.id, name: data.name, arguments: data.arguments, status: "running" }] }
              : m));
            pushLive(
              [
                ...liveMessages,
                {
                  id: data.id || createId(),
                  role: "tool",
                  tool_call_id: data.id,
                  name: data.name,
                  content: JSON.stringify({ status: "running", arguments: data.arguments }),
                  status: "running",
                  createdAt: new Date().toISOString(),
                },
              ],
              `Tool: ${data.name}…`
            );
          } else if (event.type === "tool_result") {
            const next = {
              id: data.id || createId(),
              role: "tool",
              tool_call_id: data.id,
              name: data.name,
              content: data.content,
              status: "done",
              createdAt: new Date().toISOString(),
            };
            const index = liveMessages.findIndex(
              (m) => m.role === "tool" && m.tool_call_id === data.id && m.status === "running"
            );
            pushLive(
              index >= 0
                ? liveMessages.map((m, i) => (i === index ? next : m))
                : [...liveMessages, next],
              `Tool done: ${data.name}`
            );
            pushLive(liveMessages.map((m) => m.id === assistantId
              ? { ...m, segments: (m.segments || []).map((segment) => segment.type === "tool" && segment.callId === data.id ? { ...segment, content: data.content, status: "done" } : segment) }
              : m));
          } else if (event.type === "usage") {
            const used = Number(data.context_tokens || 0);
            const win = Number(data.context_window || 0);
            if (used > 0) setCtxUsed(used);
            if (win > 0) setCtxWindow(win);
          } else if (event.type === "task_update") {
            setTasks(data.items || []);
          } else if (event.type === "approval") {
            setApprovals((prev) => [...prev.filter((item) => item.id !== data.id), data]);
            setAgentStatus(`Waiting for approval: ${data.tool || "tool"}`);
          } else if (event.type === "ask") {
            setAsks((prev) => [...prev.filter((item) => item.id !== data.id), data]);
            setAgentStatus("Waiting for your answer…");
          } else if (event.type === "subagent_start") {
            setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), { ...data, status: "running" }]);
          } else if (event.type === "subagent_done") {
            setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data, status: data.error ? "failed" : "completed" } : item));
          } else if (event.type === "tool_progress") {
            pushLive(liveMessages.map((m) => m.id === assistantId
              ? { ...m, segments: (m.segments || []).map((segment) => segment.type === "tool" && segment.callId === data.id ? { ...segment, progress: (segment.progress || "") + (data.chunk || "") } : segment) }
              : m));
          } else if (event.type === "notice") {
            setAgentStatus(data.message || "Working…");
          } else if (event.type === "done") {
            finalizeServerEvent(data);
          } else if (event.type === "error") {
            finalizeServerEvent(data, true);
          }
        },
      };
      liveRunRef.current.set(started.id, liveCtx);
      connectRunSocket(started.id, 0, liveCtx);
    } catch (e) {
      const errText = textValue(e.message) || "Failed to send";
      await finalizeRun({
        sessionId,
        sessionMeta,
        titleSeed,
        assistantId,
        liveMessages,
        assistantText: assistantText || `Error: ${errText}`,
        stopped: false,
        errorText: errText,
      });
      if (currentRunId) liveRunRef.current.delete(currentRunId);
      stopRunTransport(currentRunId || undefined);
      applyUiIfActive(sessionId, () => {
        setIsSending(false);
        setAgentStatus("");
      });
    }
  };

  const handleKeyDown = (event) => {
    if (commandOptions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandIndex((value) => (value + 1) % commandOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandIndex((value) => (value - 1 + commandOptions.length) % commandOptions.length);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const command = commandOptions[commandIndex];
        setDraft(`/${command.name}${command.args ? " " : ""}`);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (draft.trim().startsWith("/")) runCommand(draft);
      else if (canSend) sendMessage();
      return;
    }
    const caretOnFirstLine = !draft.slice(0, event.currentTarget.selectionStart || 0).includes("\n");
    const caretOnLastLine = !draft.slice(event.currentTarget.selectionStart || 0).includes("\n");
    if (event.key === "ArrowUp" && caretOnFirstLine && inputHistory.length > 0) {
      event.preventDefault();
      if (historyPos === -1) draftRefForHistory.current = draft;
      const idx = historyPos === -1 ? 0 : Math.min(historyPos + 1, inputHistory.length - 1);
      setHistoryPos(idx);
      setDraft(inputHistory[idx] || "");
      return;
    }
    if (event.key === "ArrowDown" && historyPos >= 0 && caretOnLastLine) {
      event.preventDefault();
      if (historyPos <= 0) {
        setHistoryPos(-1);
        setDraft(draftRefForHistory.current);
      } else {
        const idx = historyPos - 1;
        setHistoryPos(idx);
        setDraft(inputHistory[idx] || "");
      }
      return;
    }
    if (event.key === "Escape" && isSending) handleStop();
    if ((event.altKey || event.ctrlKey) && !event.shiftKey) {
      if (event.key === "a" || event.key === "A") {
        if (approvals.length > 0) {
          event.preventDefault();
          resolveGate(approvals[0], "allow");
        }
        return;
      }
      if (event.key === "d" || event.key === "D") {
        if (approvals.length > 0) {
          event.preventDefault();
          resolveGate(approvals[0], "deny");
        }
        return;
      }
    }
  };

  const resolveGate = async (gate, outcome, always = false) => {
    const runId = getChatRun(activeSessionId)?.runId;
    if (!runId) return;
    try {
      const res = await fetch(`/api/chat/runs/${runId}/gates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateId: gate.id, outcome, always }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to resolve");
      }
      if (always && outcome === "allow") {
        setAutoApprove(true);
        setError("Auto-approve enabled for this run");
      }
    } catch (e) {
      setError(textValue(e.message));
    }
    setApprovals((prev) => prev.filter((item) => item.id !== gate.id));
    setAsks((prev) => prev.filter((item) => item.id !== gate.id));
  };

  const handleExport = (format) => {
    if (!activeSession) return;
    const payload = { ...activeSession, messages };
    if (format === "md") {
      downloadText(`${(activeSession.title || "chat").replace(/\s+/g, "-")}.md`, exportSessionMarkdown(payload));
    } else {
      downloadText(
        `${(activeSession.title || "chat").replace(/\s+/g, "-")}.json`,
        JSON.stringify(payload, null, 2)
      );
    }
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  const sessionAction = async (action, extra = {}) => {
    if (!activeSessionId) return null;
    const res = await fetch(`/api/chat/sessions/${activeSessionId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Unable to ${action}`);
    if (action === "fork") {
      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
    }
    setMessages(data.messages || []);
    return data;
  };

  const saveCodebase = async () => {
    const value = codebaseValue.trim();
    try {
      await patchSession(activeSessionId, { codebase: value });
      setCodebase(value);
      setCodebaseEdit(false);
      setError(value ? `Codebase set: ${value}` : "Codebase cleared");
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const loadMcpServers = async () => {
    try {
      const res = await fetch("/api/chat/mcp");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setMcpServers(data.servers || []);
    } catch {
      // ignore
    }
  };

  const addMcpServer = async () => {
    const name = mcpForm.name.trim();
    const url = mcpForm.url.trim();
    const command = mcpForm.command.trim();
    const args = mcpForm.args.split(" ").map((a) => a.trim()).filter(Boolean);
    if (!name) {
      setError("MCP server name is required");
      return;
    }
    if (mcpForm.transport === "sse" && !url) {
      setError("MCP URL is required for SSE transport");
      return;
    }
    if (mcpForm.transport === "stdio" && !command) {
      setError("MCP command is required for stdio transport");
      return;
    }
    try {
      const res = await fetch("/api/chat/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, transport: mcpForm.transport, command, args }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to add MCP server");
      setMcpForm({ name: "", url: "", transport: "sse", command: "", args: "" });
      await loadMcpServers();
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const removeMcpServer = async (id) => {
    try {
      await fetch(`/api/chat/mcp/${id}`, { method: "DELETE" });
      await loadMcpServers();
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const toggleMcpServer = async (server) => {
    try {
      const res = await fetch(`/api/chat/mcp/${server.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to toggle");
      await loadMcpServers();
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const probeMcpServer = async () => {
    const url = mcpForm.url.trim();
    const command = mcpForm.command.trim();
    if (mcpForm.transport === "sse" && !url) return;
    if (mcpForm.transport === "stdio" && !command) return;
    setMcpProbe({ loading: true });
    try {
      const res = await fetch("/api/chat/mcp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          probe: mcpForm.transport === "sse"
            ? { transport: "sse", url }
            : { transport: "stdio", command, args: mcpForm.args.split(" ").map((a) => a.trim()).filter(Boolean) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMcpProbe({ loading: false, tools: data.tools || [], error: data.error || null });
    } catch (e) {
      setMcpProbe({ loading: false, tools: [], error: textValue(e.message) });
    }
  };

  const handleEditMessage = async (message) => {
    const nextText = globalThis.prompt?.("Edit message", textValue(message.content));
    if (nextText == null || !nextText.trim() || nextText.trim() === textValue(message.content).trim()) return;
    try {
      const data = await sessionAction("edit", { messageId: message.id, content: nextText.trim() });
      await sendMessage({ regenerate: true, sourceMessages: data.messages || [] });
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const runCommand = async (line) => {
    const [rawName, ...parts] = line.trim().slice(1).split(/\s+/);
    const name = rawName.toLowerCase();
    const value = parts.join(" ");
    setDraft("");
    try {
      if (name === "help") {
        const list = CHAT_COMMANDS.map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.summary}`).join("\n");
        setMessages((prev) => [...prev, { id: `sys_${Date.now()}`, role: "system", content: list, status: "done", createdAt: new Date().toISOString() }]);
      } else if (name === "new") await handleNewChat();
      else if (name === "clear") await sessionAction("clear");
      else if (name === "undo") await sessionAction("undo");
      else if (name === "fork") await sessionAction("fork", { title: value });
      else if (name === "rename") {
        if (!value) throw new Error("Usage: /rename <title>");
        await patchSession(activeSessionId, { title: value });
      } else if (name === "model") setModelModalOpen(true);
      else if (name === "agent") {
        const role = AGENT_ROLES.find((item) => item.id === value.toLowerCase());
        if (!role) throw new Error(`Usage: /agent ${AGENT_ROLES.map((item) => item.id).join("|")}`);
        setAgentRole(role.id);
      }
      else if (name === "retry") sendMessage({ regenerate: true });
      else if (name === "stop") handleStop();
      else if (name === "export") handleExport(value === "json" ? "json" : "md");
      else if (name === "steer") {
        const runId = getChatRun(activeSessionId)?.runId;
        if (!runId || !value) throw new Error("Usage during an active run: /steer <instruction>");
        const res = await fetch(`/api/chat/runs/${runId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: value }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Unable to steer run");
        setAgentStatus("Steering queued");
      }       else if (name === "approve") {
        if (approvals.length === 0) throw new Error("No pending approval");
        await resolveGate(approvals[0], "allow");
        setError("Approval granted");
      } else if (name === "deny") {
        if (approvals.length === 0) throw new Error("No pending approval");
        await resolveGate(approvals[0], "deny");
        setError("Approval denied");
      } else if (name === "project") {
        if (!value) throw new Error("Usage: /project <absolute path>");
        const inspect = await fetch("/api/chat/projects/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: value }) });
        const data = await inspect.json().catch(() => ({}));
        if (!inspect.ok) throw new Error(data.error || "Unable to inspect project");
        await patchSession(activeSessionId, { workspacePath: data.workspacePath, projectMeta: { name: data.name, packageName: data.packageName } });
        setProjectInfo(data);
        setProjectOpen(true);
        setPendingProject({ path: data.workspacePath, name: data.name });
      } else if (name === "codebase") {
        const current = sessions.find((s) => s.id === activeSessionId);
        if (current) openEditModal(current);
      } else if (name === "mcp") {
        await loadMcpServers();
        setMcpModalOpen(true);
      } else if (name === "goal") {
        const [sub, ...rest] = value.split(/\s+/);
        const arg = rest.join(" ");
        if (!sub) throw new Error("Usage: /goal <text> | status | pause | resume | clear");
        let action = "set";
        let text = value;
        if (sub === "status") action = "status";
        else if (sub === "pause") action = "pause";
        else if (sub === "resume") action = "resume";
        else if (sub === "clear") action = "clear";
        else if (sub === "set") { action = "set"; text = arg; if (!text) throw new Error("/goal set <text>"); }
        const res = await fetch(`/api/chat/sessions/${activeSessionId}/goal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, text }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Unable to update goal");
        setError(data.goal ? `Goal: ${data.goal.text} (${data.goal.status}, ${data.goal.iterations} iterations)` : "Goal cleared");
      } else if (name === "verify") {
        setVerifyMode((v) => !v);
        setError(verifyMode ? "Verification disabled for next run" : "Verification enabled for next run");
      } else if (name === "compact") {
        const keepLastN = 20; // auto-compaction preserves last N messages
        await sendMessage({
          systemPromptOverride: `You are now acting as a session compressor. Your task is to summarize all older messages while keeping the most recent ${keepLastN} messages verbatim. Write your comprehensive summary using write_file to /tmp/compact_summary.md. Then call compact_session with keepLastN=${keepLastN}.`,
        });
      } else throw new Error(`Unknown command: /${name}`);
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted text-sm">
        Loading chat…
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 h-full w-full bg-background text-text-main overflow-hidden">
      {/* Sessions rail */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-sidebar/40">
        <div className="p-3 border-b border-border space-y-2">
          <Button className="w-full" icon="add" onClick={openCreateModal}>
            New chat
          </Button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <p className="text-xs text-text-muted p-3">No sessions yet.</p>
          ) : (
            filteredSessions.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  className={`group rounded-xl border px-2.5 py-2 cursor-pointer transition ${
                    active
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:bg-sidebar hover:border-border"
                  }`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className={`mt-0.5 material-symbols-outlined text-[16px] ${
                        session.pinned ? "text-primary" : "text-text-muted opacity-0 group-hover:opacity-100"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTogglePin(session);
                      }}
                      title="Pin"
                    >
                      keep
                    </button>
                    <div className="min-w-0 flex-1">
                      {renameId === session.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(session.id);
                            if (e.key === "Escape") setRenameId("");
                          }}
                          onBlur={() => handleRename(session.id)}
                          className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      ) : (
                        <p className="truncate text-sm font-medium">{session.title || "New chat"}</p>
                      )}
                      <p className="truncate text-[11px] text-text-muted mt-0.5">
                        {session.model || "No model"} · {formatRelativeTime(session.updatedAt)}
                      </p>
                    </div>
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        className="material-symbols-outlined text-[15px] text-text-muted hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(session);
                        }}
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        className="material-symbols-outlined text-[15px] text-text-muted hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                      >
                        delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main */}
      <section className="flex flex-1 min-w-0 flex-col">
        <header className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 lg:px-4">
          <button
            type="button"
            onClick={() => setModelModalOpen(true)}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-sidebar/50 px-3 py-2 text-left hover:bg-sidebar"
          >
            <span className="material-symbols-outlined text-[18px] text-primary">smart_toy</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{activeSession?.model || "Select model"}</p>
              <p className="truncate text-[11px] text-text-muted">Click to change</p>
            </div>
          </button>

          {codebase ? (
            <button
              type="button"
              onClick={() => { setCodebaseValue(codebase); setCodebaseEdit(true); }}
              className="hidden min-w-0 max-w-[16rem] items-center gap-1.5 rounded-xl border border-border bg-sidebar/50 px-3 py-2 text-left hover:bg-sidebar md:flex"
              title="Session codebase / repository URL — click to edit"
            >
              <span className="material-symbols-outlined text-[15px] text-primary">link</span>
              <span className="truncate font-mono text-[11px] text-text-muted">{codebase}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { setCodebaseValue(codebase); setCodebaseEdit(true); }}
              className="hidden items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-[11px] text-text-muted hover:bg-sidebar md:flex"
              title="Set a codebase / repository URL for this session"
            >
              <span className="material-symbols-outlined text-[15px]">link</span>
              Codebase
            </button>
          )}

          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            <div className="flex rounded-full border border-border overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode("raw")}
                className={`px-2.5 py-1.5 ${
                  viewMode === "raw"
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-text-muted hover:bg-sidebar"
                }`}
                title="Show tool calls in transcript"
              >
                Raw
              </button>
              <button
                type="button"
                onClick={() => setViewMode("chat")}
                className={`px-2.5 py-1.5 border-l border-border ${
                  viewMode === "chat"
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-text-muted hover:bg-sidebar"
                }`}
                title="Hide tool calls — only user/assistant messages"
              >
                Only chat
              </button>
            </div>
            <Button variant="ghost" size="sm" icon="tune" onClick={() => setParamsOpen((v) => !v)}>
              Params
            </Button>
            <Button variant="ghost" size="sm" icon="psychology" onClick={() => setShowReasoning((value) => !value)}>
              {showReasoning ? "Reasoning" : "Hidden"}
            </Button>
            <Button variant="ghost" size="sm" icon="extension" onClick={() => { loadMcpServers(); setMcpModalOpen(true); }}>
              MCP
            </Button>
            {activeSession?.workspacePath ? (
              <Button variant="ghost" size="sm" icon="folder_open" onClick={() => setProjectOpen((value) => !value)}>
                Project
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" icon="download" onClick={() => handleExport("md")}>
              MD
            </Button>
            <Button variant="ghost" size="sm" icon="data_object" onClick={() => handleExport("json")}>
              JSON
            </Button>
            <Button className="md:hidden" variant="ghost" size="sm" icon="add" onClick={openCreateModal}>
              New
            </Button>
          </div>
        </header>

        {isSending ? (
          <div className="shrink-0 border-b border-border bg-primary/5 px-4 py-1.5 text-[11px] text-primary flex items-center gap-2">
            <span className="flex items-center gap-0.5">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              <span className="size-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.15s]" />
              <span className="size-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.3s]" />
            </span>
            <span className="truncate">
              {liveInfo.waiting ? (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">help</span>
                  Waiting for your answer…
                </span>
              ) : liveInfo.notice ? (
                liveInfo.notice
              ) : liveInfo.tool ? (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">build</span>
                  Running: {liveInfo.tool}
                  {liveInfo.turn > 0 ? ` · step ${liveInfo.turn}` : ""}
                </span>
              ) : (
                <span>
                  Working{liveInfo.turn > 0 ? ` · step ${liveInfo.turn}` : ""}
                  {liveInfo.elapsed > 0 ? ` · ${liveInfo.elapsed}s` : ""}
                </span>
              )}
            </span>
          </div>
        ) : null}

        {paramsOpen ? (
          <div className="shrink-0 border-b border-border bg-sidebar/30 px-4 py-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs text-text-muted space-y-1">
              <span>Temperature ({params.temperature})</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={params.temperature}
                onChange={(e) => handleParamsChange("temperature", e.target.value)}
                className="w-full"
              />
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Max tokens</span>
              <input
                type="number"
                min="1"
                value={params.max_tokens}
                onChange={(e) => handleParamsChange("max_tokens", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
              />
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Max tool steps ({maxSteps === 0 ? "Unlimited" : maxSteps})</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value) || 0)}
                className="w-full"
              />
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Top P ({params.top_p})</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={params.top_p}
                onChange={(e) => handleParamsChange("top_p", e.target.value)}
                className="w-full"
              />
            </label>
            <label className="text-xs text-text-muted space-y-1 sm:col-span-2 lg:col-span-1">
              <span>System prompt</span>
              <textarea
                rows={2}
                value={activeSession?.systemPrompt || ""}
                onChange={(e) =>
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.id === activeSessionId ? { ...s, systemPrompt: e.target.value } : s
                    )
                  )
                }
                onBlur={() =>
                  activeSessionId &&
                  patchSession(activeSessionId, {
                    systemPrompt: activeSession?.systemPrompt || "",
                  }).catch((e) => setError(textValue(e.message)))
                }
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main resize-none"
                placeholder="Optional system instructions"
              />
            </label>
          </div>
        ) : null}

        {!apiKey ? (
          <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            No API key found.{" "}
            <Link href="/dashboard/endpoint" className="underline font-medium">
              Create one in Endpoint & Key
            </Link>
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300 flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <div className="flex-1">{error}</div>
            <button type="button" className="text-xs underline" onClick={() => setError("")}>
              dismiss
            </button>
          </div>
        ) : null}

        <div ref={transcriptScrollRef} onScroll={handleTranscriptScroll} className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 lg:px-6">
          {messages.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center gap-4">
              <div className="size-14 rounded-2xl border border-border bg-sidebar flex items-center justify-center">
                <span className="material-symbols-outlined text-[28px] text-primary">chat</span>
              </div>
              <div>
                <h2 className="text-xl font-semibold">Start a conversation</h2>
                <p className="mt-1 text-sm text-text-muted max-w-md">
                  Multi-session chat over your connected providers. History is stored in SQLite.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                {[
                  "Explain this error and propose a fix",
                  "Write a unit test for this function",
                  "Review this design for hidden risks",
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setDraft(chip)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-sidebar"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {windowed.start > 0 ? <div className="py-2 text-center text-[11px] text-text-muted">Earlier messages hidden · scroll up to reveal</div> : null}
              {windowed.list.map((message, wi) => {
                const isUser = message.role === "user";
                const isTool = message.role === "tool";
                const isSystem = message.role === "system";
                const content = textValue(message.content);
                const globalIndex = windowed.start + wi;

                if (isSystem) {
                  return (
                    <div key={message.id} data-chat-message-index={globalIndex} className="flex justify-start">
                      <div className="max-w-[min(92%,42rem)] w-full rounded-xl border border-border bg-background/40 px-3 py-2">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-text-muted">
                          <span className="material-symbols-outlined text-[13px]">terminal</span>
                          Command
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-muted">{content}</pre>
                      </div>
                    </div>
                  );
                }

                if (isTool) {
                  const preview =
                    content.length > 1200 ? `${content.slice(0, 1200)}\n…` : content;
                  return (
                    <div key={message.id} data-chat-message-index={globalIndex} className="flex justify-start">
                      <div className="max-w-[min(92%,42rem)] w-full rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2">
                        <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          <span className="material-symbols-outlined text-[14px]">
                            {message.status === "running" ? "progress_activity" : "build"}
                          </span>
                          <span>tool · {message.name || "unknown"}</span>
                          <span className="opacity-60 font-normal">
                            {message.status === "running" ? "running…" : "done"}
                          </span>
                          <button
                            type="button"
                            className="ml-auto material-symbols-outlined text-[14px] opacity-60 hover:opacity-100"
                            onClick={() => handleCopy(content)}
                          >
                            content_copy
                          </button>
                        </div>
                        <pre className="mt-1.5 max-h-48 overflow-auto custom-scrollbar whitespace-pre-wrap break-words text-[11px] leading-5 text-text-muted font-mono">
                          {preview}
                        </pre>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={message.id} data-chat-message-index={globalIndex} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[min(92%,42rem)] rounded-2xl px-4 py-3 ${
                        isUser
                          ? "bg-primary text-white"
                          : message.status === "error"
                            ? "bg-red-500/10 border border-red-500/20"
                            : "bg-sidebar border border-border"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-[11px] font-semibold opacity-80">
                          {isUser ? "You" : activeSession?.model || "Assistant"}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100"
                            onClick={() => handleCopy(content)}
                            title="Copy"
                          >
                            content_copy
                          </button>
                          {isUser ? (
                            <button
                              type="button"
                              className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100"
                              onClick={() => handleEditMessage(message)}
                              title="Edit and resend"
                              disabled={isSending}
                            >
                              edit
                            </button>
                          ) : null}
                          {!isUser ? (
                            <button
                              type="button"
                              className="material-symbols-outlined text-[14px] opacity-60 hover:opacity-100"
                              onClick={() => sendMessage({ regenerate: true })}
                              title="Regenerate"
                              disabled={isSending}
                            >
                              refresh
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {message.attachments?.length ? (
                        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {message.attachments.map((a) => (
                            <button
                              key={a.id || a.name}
                              type="button"
                              onClick={() => a.dataUrl && setImagePreview({ src: a.dataUrl, name: a.name || "Image" })}
                              className="overflow-hidden rounded-lg border border-white/10 text-left hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
                              title="View image"
                            >
                              <img src={a.dataUrl} alt={a.name} className="h-24 w-full object-cover" />
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {viewMode === "raw" && message.tool_calls?.length ? (
                        <div className="mb-2 flex flex-wrap gap-1">
                          {message.tool_calls.map((tc) => (
                            <span
                              key={tc.id}
                              className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-text-muted"
                            >
                              {tc.function?.name || "tool"}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div>
                        {!isUser && message.segments?.length ? (
                          <div className="space-y-3">
                            {message.segments.map((segment, index) => segment.type === "reasoning" ? (
                              showReasoning ? <details key={`${segment.type}-${index}`} className="rounded-xl border border-border bg-background/40 px-3 py-2" open={message.status === "streaming"}><summary className="cursor-pointer text-[11px] font-medium text-text-muted">Reasoning</summary><div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">{segment.content}</div></details> : null
                            ) : segment.type === "tool" ? (
                              viewMode === "raw" ? <ChatToolCard key={segment.callId || index} segment={segment} /> : null
                            ) : (
                              <ChatMarkdown key={`${segment.type}-${index}`} content={segment.content} />
                            ))}
                          </div>
                        ) : isUser ? <div className="whitespace-pre-wrap break-words text-[14px] leading-6">{content}</div> : <ChatMarkdown content={content} />}
                        {(message.status === "streaming" || message.status === "tool_calls") &&
                        !content ? (
                          <span className="inline-block animate-pulse">▋</span>
                        ) : null}
                      </div>
                      {message.tokenUsage ? (
                        <p className="mt-2 text-[10px] opacity-60">
                          tokens: {message.tokenUsage.total_tokens ||
                            (message.tokenUsage.prompt_tokens || 0) +
                              (message.tokenUsage.completion_tokens || 0)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {windowed.end < visibleMessages.length ? <div className="py-2 text-center text-[11px] text-text-muted">Scroll down for newer messages</div> : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-3 py-3 lg:px-6">
          {attachments.length > 0 ? (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="relative group flex items-center gap-2 rounded-xl border border-border bg-sidebar px-2 py-1.5 text-xs"
                >
                  {a.dataUrl ? (
                    <button
                      type="button"
                      onClick={() => setImagePreview({ src: a.dataUrl, name: a.name || "Image" })}
                      className="shrink-0"
                      title="View image"
                    >
                      <img src={a.dataUrl} alt={a.name} className="h-10 w-10 rounded-lg object-cover border border-border" />
                    </button>
                  ) : (
                    <span className="material-symbols-outlined shrink-0 text-[18px] text-primary">description</span>
                  )}
                  <span className="max-w-[8rem] truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                    className="material-symbols-outlined text-[14px] text-text-muted"
                  >
                    close
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {(tasks.length > 0 || subAgents.length > 0) ? (
            <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-border bg-sidebar/35 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {tasks.length > 0 ? <span className="font-medium">Tasks {tasks.filter((item) => item.status === "completed").length}/{tasks.length}</span> : null}
                {tasks.map((item, index) => <span key={index} className={`rounded-full px-2 py-0.5 ${item.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : item.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-background text-text-muted"}`}>{item.content}</span>)}
                {subAgents.map((agent) => <button key={agent.id} type="button" title={agent.task} onClick={() => setViewingAgent(agent)} className="rounded-full border border-border px-2 py-0.5 hover:bg-sidebar"><span className={agent.status === "running" ? "text-primary" : agent.status === "failed" ? "text-red-500" : "text-emerald-500"}>●</span> {agent.role}</button>)}
              </div>
            </div>
          ) : null}
          {approvals.map((approval) => (
            <div key={approval.id} className="mx-auto mb-2 max-w-3xl rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[20px] text-amber-500">shield</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Allow {approval.tool} to run?</p>
                  <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-background/60 p-2.5 font-mono text-[11px] leading-5">{approval.arguments || "{}"}</pre>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => resolveGate(approval, "allow")}>Allow</Button>
                    <Button size="sm" variant="outline" onClick={() => resolveGate(approval, "allow", true)}>Always allow</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveGate(approval, "deny")}>Deny</Button>
                    <span className="text-[10px] text-text-muted">Auto-deny after 120s</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {asks.map((ask) => (
            <AskWizard key={ask.id} ask={ask} onAnswer={(answer) => resolveGate(ask, answer)} />
          ))}
          <div
            ref={composerRef}
            className="relative mx-auto max-w-3xl rounded-2xl border border-border bg-sidebar/40 p-2 shadow-sm"
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
            }}
            onDrop={handleComposerDrop}
          >
            <SlashCommandPalette matches={commandOptions} selected={commandIndex} onPick={(command) => setDraft(`/${command.name}${command.args ? " " : ""}`)} />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handleComposerPaste}
              rows={1}
              placeholder={
                activeSession?.model
                  ? "Message… (paste or drop images/files)"
                  : "Select a model first"
              }
              className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none max-h-[25vh] custom-scrollbar"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 text-text-muted hover:bg-sidebar hover:text-text-main"
                  title="Attach or paste images"
                >
                  <span className="material-symbols-outlined text-[20px]">image</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleAttachFiles}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="hidden rounded-lg p-2 text-text-muted hover:bg-sidebar hover:text-text-main sm:block"
                  title="Attach or drop files"
                >
                  <span className="material-symbols-outlined text-[20px]">attach_file</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAutoApprove((value) => !value)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex ${autoApprove ? "bg-emerald-500/10 text-emerald-600" : "text-text-muted hover:bg-sidebar"}`}
                  title="Auto-approve all tools for this run"
                >
                  <span className="material-symbols-outlined text-[15px]">{autoApprove ? "task_alt" : "shield"}</span>
                  {autoApprove ? "Auto" : "Approve"}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRoleMenuOpen((value) => !value)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-text-muted hover:bg-sidebar hover:text-text-main"
                    title="Choose agent role"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">
                      {AGENT_ROLES.find((role) => role.id === agentRole)?.icon || "hub"}
                    </span>
                    <span>{AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Orchestrator"}</span>
                    <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  </button>
                  {roleMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-3 w-64 rounded-xl border border-primary/35 bg-surface p-1.5 shadow-[0_20px_55px_rgba(0,0,0,0.65)] ring-1 ring-black/30">
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Agent role</p>
                      {AGENT_ROLES.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            setAgentRole(role.id);
                            setRoleMenuOpen(false);
                          }}
                          className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${agentRole === role.id ? "border-primary/35 bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
                        >
                          <span className="material-symbols-outlined mt-0.5 text-[17px] text-primary">{role.icon}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium">{role.label}</span>
                            <span className="block text-[10px] text-text-muted">{role.description}</span>
                          </span>
                          {agentRole === role.id ? <span className="material-symbols-outlined text-[16px] text-primary">check</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setAccessMode((value) => value === "full" ? "sandbox" : "full")}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] ${accessMode === "full" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-text-muted hover:bg-sidebar"}`}
                  title={accessMode === "full" ? "Full: bash and file writes enabled" : "Sandbox: read-only host tools"}
                >
                  <span className="material-symbols-outlined text-[15px]">{accessMode === "full" ? "admin_panel_settings" : "shield"}</span>
                  {accessMode === "full" ? "Full" : "Sandbox"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReasoning((value) => !value)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] ${showReasoning ? "text-primary" : "text-text-muted hover:bg-sidebar"}`}
                  title="Show or hide reasoning"
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span>
                  Reasoning
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEffortMenuOpen((value) => !value)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex ${reasoningEffort ? "text-primary" : "text-text-muted hover:bg-sidebar"}`}
                    title="Reasoning effort for the next turn"
                  >
                    <span className="material-symbols-outlined text-[15px]">tune</span>
                    <span>{reasoningEffort ? reasoningEffort.charAt(0).toUpperCase() + reasoningEffort.slice(1) : "Effort"}</span>
                    <span className="material-symbols-outlined text-[14px]">expand_more</span>
                  </button>
                  {effortMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-3 w-56 rounded-xl border border-primary/35 bg-surface p-1.5 shadow-[0_20px_55px_rgba(0,0,0,0.65)] ring-1 ring-black/30">
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Reasoning effort</p>
                      {[{ value: "", label: "Default", hint: "Use the configured default" }, { value: "none", label: "Off", hint: "No reasoning" }, { value: "low", label: "Low", hint: "Brief reasoning" }, { value: "medium", label: "Medium", hint: "Balanced reasoning" }, { value: "high", label: "High", hint: "Deep reasoning" }].map((option) => (
                        <button
                          key={option.value || "default"}
                          type="button"
                          onClick={() => {
                            setReasoningEffort(option.value);
                            setEffortMenuOpen(false);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${reasoningEffort === option.value ? "border-primary/35 bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
                        >
                          <span className={`material-symbols-outlined text-[15px] ${reasoningEffort === option.value ? "text-primary" : "text-text-muted"}`}>{reasoningEffort === option.value ? "check" : "radio_button_unchecked"}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium">{option.label}</span>
                            <span className="block text-[10px] text-text-muted">{option.hint}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ctxWindow > 0 ? (
                  <div className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px]" title={`Context: ${ctxUsed?.toLocaleString() ?? 0} / ${ctxWindow?.toLocaleString() ?? "?"} tokens`}>
                    <span className={`size-2.5 rounded-full ${ctxUsed > ctxWindow * 0.8 ? "bg-red-500" : ctxUsed > ctxWindow * 0.6 ? "bg-amber-500" : "bg-emerald-500"}`} />
                    <span className="hidden text-text-muted sm:inline">{Math.round((ctxUsed / ctxWindow) * 100)}%</span>
                  </div>
                ) : null}
                {isSending ? (
                  <Button variant="ghost" size="sm" icon="stop" onClick={handleStop}>
                    Stop
                  </Button>
                ) : null}
                <Button size="sm" icon="send" onClick={() => draft.trim().startsWith("/") ? runCommand(draft) : sendMessage()} disabled={!draft.trim().startsWith("/") && !canSend}>
                  Send
                </Button>
              </div>
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-text-muted">
            Enter send · Shift+Enter newline · ↑/↓ history · Esc stop · / for commands · {AGENT_ROLES.find((role) => role.id === agentRole)?.label} · {accessMode} access
          </p>
        </div>
      </section>

      {projectOpen && activeSession?.workspacePath ? (
        <div className="hidden xl:block w-80 shrink-0 min-w-0">
          <ProjectSidebar
            workspacePath={activeSession.workspacePath}
            sessionId={activeSessionId}
            refreshKey={projectRefresh}
            messages={messages}
            onRun={(cmd) => { setDraft(`Run: ${cmd}`); }}
            onClose={() => setProjectOpen(false)}
          />
        </div>
      ) : null}

      <ModelSelectModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        onSelect={handleSelectModel}
        selectedModel={activeSession?.model || ""}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select chat model"
      />

      {mcpModalOpen ? (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setMcpModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Manage MCP servers"
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">extension</span>
                <p className="text-sm font-semibold">MCP Servers</p>
              </div>
              <button onClick={() => setMcpModalOpen(false)} className="text-text-muted hover:text-text-main">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="mb-3 space-y-2">
              <input
                type="text"
                value={mcpForm.name}
                onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value.replace(/\s+/g, "-").toLowerCase() }))}
                placeholder="Server name (e.g. my-server)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <div className="flex rounded-full border border-border overflow-hidden text-[11px] w-fit">
                <button
                  type="button"
                  onClick={() => setMcpForm((f) => ({ ...f, transport: "sse" }))}
                  className={`px-3 py-1.5 ${mcpForm.transport === "sse" ? "bg-primary/15 text-primary font-medium" : "text-text-muted hover:bg-sidebar"}`}
                >
                  SSE / HTTP
                </button>
                <button
                  type="button"
                  onClick={() => setMcpForm((f) => ({ ...f, transport: "stdio" }))}
                  className={`px-3 py-1.5 border-l border-border ${mcpForm.transport === "stdio" ? "bg-primary/15 text-primary font-medium" : "text-text-muted hover:bg-sidebar"}`}
                >
                  Stdio
                </button>
              </div>
              {mcpForm.transport === "sse" ? (
                <input
                  type="text"
                  value={mcpForm.url}
                  onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://host/mcp or http://host/sse"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              ) : (
                <>
                  <input
                    type="text"
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="Command (e.g. npx, uvx, bun, node)"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                  <input
                    type="text"
                    value={mcpForm.args}
                    onChange={(e) => setMcpForm((f) => ({ ...f, args: e.target.value }))}
                    placeholder="Args (space separated, e.g. -y @mcp/server)"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </>
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={addMcpServer}>Add</Button>
                <Button size="sm" variant="ghost" onClick={probeMcpServer}>Probe tools</Button>
                {mcpProbe?.loading ? <span className="text-[11px] text-text-muted">Probing…</span> : null}
              </div>
              {mcpProbe?.tools?.length ? (
                <div className="rounded-lg border border-border bg-background p-2">
                  <p className="mb-1 text-[10px] font-medium text-text-muted">{mcpProbe.tools.length} tools discovered</p>
                  <div className="flex flex-wrap gap-1">
                    {mcpProbe.tools.map((t) => (
                      <span key={t.name} className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[10px]">{t.name}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {mcpProbe?.error ? <p className="text-[11px] text-red-500">{mcpProbe.error}</p> : null}
            </div>

            <div className="max-h-56 space-y-1 overflow-y-auto">
              {mcpServers.length === 0 ? (
                <p className="py-3 text-center text-xs text-text-muted">No MCP servers yet.</p>
              ) : (
                mcpServers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                    <button
                      onClick={() => toggleMcpServer(s)}
                      className={`size-3.5 rounded-full ${s.enabled ? "bg-emerald-500" : "bg-border"}`}
                      title={s.enabled ? "Enabled" : "Disabled"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{s.name}</p>
                      <p className="truncate font-mono text-[10px] text-text-muted">{s.url || s.command}</p>
                    </div>
                    <span className="text-[10px] uppercase text-text-muted">{s.transport}</span>
                    <button
                      onClick={() => removeMcpServer(s.id)}
                      className="material-symbols-outlined text-[15px] text-text-muted hover:text-red-500"
                    >
                      delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingProject ? (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPendingProject(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Analyze project"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">travel_explore</span>
              <p className="text-sm font-semibold">Project bound: {pendingProject.name}</p>
            </div>
            <p className="text-[12px] text-text-muted">Analyze this project first so the agent understands the structure, stack, and how to run it?</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => resolveAnalyze(false)}>No, just chat</Button>
              <Button size="sm" onClick={() => resolveAnalyze(true)}>Analyze</Button>
            </div>
          </div>
        </div>
      ) : null}

      {sessionModalOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSessionModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={sessionModalMode === "edit" ? "Edit session" : "New session"}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">
                {sessionModalMode === "edit" ? "edit" : "add"}
              </span>
              <p className="text-sm font-semibold">
                {sessionModalMode === "edit" ? "Edit session" : "New session"}
              </p>
            </div>
            <label className="mb-1 block text-[11px] font-medium text-text-muted">Session name</label>
            <input
              autoFocus
              type="text"
              value={sessionFormName}
              onChange={(e) => setSessionFormName(e.target.value)}
              placeholder="e.g. Antares chat integration"
              className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <label className="mb-1 block text-[11px] font-medium text-text-muted">Project URL / path</label>
            <input
              type="text"
              value={sessionFormUrl}
              onChange={(e) => setSessionFormUrl(e.target.value)}
              placeholder="https://github.com/org/repo  or  F:\\project\\my-app"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSessionModal();
                if (e.key === "Escape") setSessionModalOpen(false);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSessionModalOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveSessionModal}>
                {sessionModalMode === "edit" ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {codebaseEdit ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setCodebaseEdit(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Set codebase"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">link</span>
              <p className="text-sm font-semibold">Session codebase / repository URL</p>
            </div>
            <input
              autoFocus
              type="text"
              value={codebaseValue}
              onChange={(e) => setCodebaseValue(e.target.value)}
              placeholder="https://github.com/org/repo or git@host:org/repo.git"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCodebase();
                if (e.key === "Escape") setCodebaseEdit(false);
              }}
            />
            <p className="mt-2 text-[11px] text-text-muted">Leave empty to clear. Applies to this session only.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCodebaseEdit(false)}>Cancel</Button>
              <Button size="sm" onClick={saveCodebase}>Save</Button>
            </div>
          </div>
        </div>
      ) : null}

      {viewingAgent ? (
        <SubAgentOverlay agent={viewingAgent} onClose={() => setViewingAgent(null)} />
      ) : null}

      {imagePreview?.src ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
          onClick={() => setImagePreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div
            className="relative max-h-[90vh] max-w-[min(96vw,56rem)] w-full rounded-2xl border border-border bg-background p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-text-main">{imagePreview.name || "Image"}</p>
              <div className="flex items-center gap-1">
                <a
                  href={imagePreview.src}
                  download={imagePreview.name || "image.png"}
                  className="rounded-lg p-1.5 text-text-muted hover:bg-sidebar hover:text-primary"
                  title="Download"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="material-symbols-outlined text-[20px]">download</span>
                </a>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-text-muted hover:bg-sidebar hover:text-text-main"
                  onClick={() => setImagePreview(null)}
                  title="Close"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>
            <img
              src={imagePreview.src}
              alt={imagePreview.name || "Preview"}
              className="max-h-[75vh] w-full rounded-xl object-contain bg-black/10"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
