"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, ModelSelectModal, ConfirmModal } from "@/shared/components";
import TeamPanel from "./TeamPanel";
import SlashCommandPalette, { CHAT_COMMANDS, commandMatches } from "./SlashCommandPalette";
import ProjectSidebar from "./ProjectSidebar";
import FolderPickerModal from "./FolderPickerModal";
import SkillsModal from "./SkillsModal";
import ShortcodesModal from "./ShortcodesModal";
import ChatHeader from "./ChatHeader";
import ChatSessionRail from "./ChatSessionRail";
import MessageList from "./MessageList";
import AskApprovalOverlay from "./AskApprovalOverlay";
import SubAgentOverlay from "./SubAgentOverlay";
import DockedTerminalPanel from "./DockedTerminalPanel";
import {
  getCachedTranscript,
  setCachedTranscript,
  deleteCachedTranscript,
  getCachedDraft,
  setCachedDraft,
  clearCachedDraft,
} from "@/lib/chat/chatCacheIndexedDb";
import {
  abortChatRun,
  buildStopSummary,
  clearChatRun,
  getActiveRunSessions,
  getChatRun,
  isRunActiveFor,
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
    prompt: "Act as the lead orchestrator. For multi-step work, publish a todo_update checklist or use team_post_task, update task status as each step progresses and completes, delegate focused read-only research or review with delegate_task, integrate the results, execute the remaining work, verify it, then report one coherent outcome. Enforce the Anti-Slop standard (https://github.com/miqdadbadjuber/anti-slop): no dead controls, real data/states, no em dashes, and rigorous verification. Do not delegate trivial work.",
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    icon: "psychology",
    description: "Autonomous local agent with deep tool execution",
    prompt: "Act as Hermes Agent, an autonomous problem-solving agent with deep terminal and tool-calling execution.",
  },
  {
    id: "team",
    label: "Agent Team",
    icon: "groups",
    description: "DSH collaborative multi-agent team",
    prompt: "Act as a Native Agent Team orchestrator (DeepSeek Harness style). You operate a collaborative multi-agent system with a shared Task Board, Agent Roster (dev, qa, architect, reviewer), and P2P messaging.\n\nCRITICAL TASK BOARD DISCIPLINE:\n- Always maintain the shared Task Board with team_post_task for EVERY task (task 1, task 2, and all subsequent tasks).\n- Before executing any task step, claim it with team_post_task(action: 'claim', taskId, assignee) so the board shows 'in_progress'.\n- When each task step finishes, mark it completed with team_post_task(action: 'update', taskId, status: 'completed').\n- For new user requests, follow-ups, or continuations, add new tasks with team_post_task(action: 'create').\n- Dispatch specialist work with team_send_message and team_roster.\n- Strictly enforce Anti-Slop rules (https://github.com/miqdadbadjuber/anti-slop): purposeful code, verified facts, no generic UI slop.",
  },
  {
    id: "coder",
    label: "Coder",
    icon: "code",
    description: "Implement and verify",
    prompt: "Act as a senior implementation agent. Inspect the code first, make the smallest correct changes, run relevant verification, then summarize changed files and evidence. Strictly follow the Anti-Slop standard (https://github.com/miqdadbadjuber/anti-slop): purposeful implementation, no broken states, no script patching, full responsive and accessible code.",
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
    prompt: "Act as a strict code reviewer. Prioritize correctness bugs, security risks, regressions, race conditions, missing tests, and Anti-Slop violations (https://github.com/miqdadbadjuber/anti-slop). Lead with findings and file references. Do not modify files unless explicitly requested.",
  },
  {
    id: "planner",
    label: "Planner",
    icon: "account_tree",
    description: "Design execution steps",
    prompt: "Act as a technical planner. Inspect current architecture, identify dependencies and risks, then produce an actionable phased plan with acceptance criteria. Adhere to the Anti-Slop standard (https://github.com/miqdadbadjuber/anti-slop). Do not modify files.",
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

function updateOrAppendSegment(segments, type, content, extra = {}) {
  const next = [...(segments || [])];
  if (type === "text" || type === "reasoning") {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].type === "tool") break;
      if (next[i].type === type) {
        next[i] = { ...next[i], content, ...extra };
        return next;
      }
    }
  }
  next.push({ type, content, ...extra });
  return next;
}

export default function ChatPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSessionId = searchParams.get("sessionId") || searchParams.get("session") || "";
  const urlWorkspace = searchParams.get("workspace") || "";

  const [sessions, setSessions] = useState([]);
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (urlSessionId) return urlSessionId;
    try {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("sessionId") || params.get("session");
        if (fromUrl) return fromUrl;
      }
      return globalThis.localStorage?.getItem("chat.activeSessionId") || "";
    } catch {
      return "";
    }
  });

  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  // ponytail: ref keeps handleSelectSession identity stable; a state dep here re-fires the URL-sync effect with a stale sessionId and yanks the user back to the previous session.
  const isSessionLoadingRef = useRef(false);
  useEffect(() => {
    isSessionLoadingRef.current = isSessionLoading;
  }, [isSessionLoading]);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);
  const sendMessageRef = useRef(null);
  const [runningSessionIds, setRunningSessionIds] = useState(() => new Set(getActiveRunSessions()));
  const runningSessionIdsRef = useRef(new Set(getActiveRunSessions()));
  useEffect(() => {
    runningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds]);
  const processingQueuesRef = useRef(new Set());
  const [sessionQueues, setSessionQueues] = useState({});
  const sessionQueuesRef = useRef({});
  useEffect(() => {
    sessionQueuesRef.current = sessionQueues;
  }, [sessionQueues]);
  const [appNotice, setAppNotice] = useState(null);
  const noticeTimerRef = useRef(null);

  const setNotice = useCallback((text, type = "error") => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    if (!text) {
      setAppNotice(null);
      return;
    }
    const str = String(text);
    let detectedType = type;
    if (type === "error") {
      const lower = str.toLowerCase();
      if (lower.includes("queued") || lower.includes("will send automatically") || lower.includes("waiting in queue")) {
        detectedType = "info";
      } else if (lower.includes("auto-approve") || lower.includes("codebase set") || lower.includes("codebase cleared") || lower.includes("saved") || lower.includes("copied")) {
        detectedType = "success";
      } else if (lower.includes("already running") || lower.includes("select a model") || lower.includes("no api key") || lower.includes("required") || lower.includes("stop it first")) {
        detectedType = "warning";
      }
    }
    setAppNotice({ text: str, type: detectedType });
    if (detectedType !== "error") {
      noticeTimerRef.current = setTimeout(() => {
        setAppNotice(null);
      }, detectedType === "success" ? 4000 : 6000);
    }
  }, []);

  const setError = useCallback((val) => {
    setNotice(val, "error");
  }, [setNotice]);

  const [renameId, setRenameId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
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
  const [imagePreview, setImagePreview] = useState(null);
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
  const [teamRoster, setTeamRoster] = useState([]);
  const [teamTasks, setTeamTasks] = useState([]);
  const [teamMessages, setTeamMessages] = useState([]);
  const [viewingAgent, setViewingAgent] = useState(null);
  const [liveInfo, setLiveInfo] = useState({ turn: 0, tool: null, waiting: false, notice: "", elapsed: 0 });
  const [approvals, setApprovals] = useState([]);
  const approvalsRef = useRef([]);
  useEffect(() => {
    approvalsRef.current = approvals;
  }, [approvals]);
  const [asks, setAsks] = useState([]);
  const asksRef = useRef([]);
  useEffect(() => {
    asksRef.current = asks;
  }, [asks]);

  // Docked bottom terminal state
  const [terminalOpen, setTerminalOpen] = useState(false);
  const toggleTerminal = useCallback(() => {
    setTerminalOpen((prev) => !prev);
  }, []);

  const pendingAskSessionIds = useMemo(() => {
    const sids = new Set();
    for (const a of asks) {
      if (a.sessionId) sids.add(a.sessionId);
    }
    for (const ap of approvals) {
      if (ap.sessionId) sids.add(ap.sessionId);
    }
    return sids;
  }, [asks, approvals]);

  const activeSessionApprovals = useMemo(
    () => approvals.filter((a) => a.sessionId === activeSessionId),
    [approvals, activeSessionId]
  );
  const activeSessionAsks = useMemo(
    () => asks.filter((a) => a.sessionId === activeSessionId),
    [asks, activeSessionId]
  );
  const [projectOpen, setProjectOpen] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("chat.projectOpen") === "true";
    } catch {
      return false;
    }
  });
  const [projectTab, setProjectTab] = useState("info");

  const toggleProject = useCallback((tabName) => {
    setProjectOpen((prev) => {
      let next;
      if (prev && projectTab === tabName) {
        next = false;
      } else {
        setProjectTab(tabName);
        next = true;
      }
      try {
        globalThis.localStorage?.setItem("chat.projectOpen", next ? "true" : "false");
      } catch {}
      return next;
    });
  }, [projectTab]);

  const [projectInfo, setProjectInfo] = useState(null);
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [pendingProject, setPendingProject] = useState(null);
  const [codebase, setCodebase] = useState("");
  const [codebaseEdit, setCodebaseEdit] = useState(false);
  const [codebaseValue, setCodebaseValue] = useState("");
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [sessionModalMode, setSessionModalMode] = useState("create");
  const [sessionFormName, setSessionFormName] = useState("");
  const [sessionFormUrl, setSessionFormUrl] = useState("");
  const [sessionFormEditId, setSessionFormEditId] = useState("");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState("sessionModal");
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [skillsModalOpen, setSkillsModalOpen] = useState(false);
  const [shortcodesModalOpen, setShortcodesModalOpen] = useState(false);
  const [shortcodes, setShortcodes] = useState([]);
  const loadShortcodes = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/shortcodes");
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.shortcodes)) setShortcodes(data.shortcodes);
    } catch {}
  }, []);

  const [mcpForm, setMcpForm] = useState({ name: "", url: "", transport: "sse", command: "", args: "" });
  const [mcpProbe, setMcpProbe] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [ctxUsed, setCtxUsed] = useState(0);
  const [ctxWindow, setCtxWindow] = useState(0);
  const isAtBottomRef = useRef(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
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
  const lastLoadedSessionIdRef = useRef("");
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const websocketRef = useRef(new Map());
  const reconnectTimerRef = useRef(new Map());
  const pollTimerRef = useRef(new Map());
  const liveRunRef = useRef(new Map());

  activeSessionIdRef.current = activeSessionId;

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const updateAgentRole = useCallback((newRole) => {
    setAgentRole(newRole);
    try {
      globalThis.localStorage?.setItem("chat.agentRole", newRole);
    } catch {}
    if (activeSessionIdRef.current) {
      const cur = sessions.find((s) => s.id === activeSessionIdRef.current);
      fetch(`/api/chat/sessions/${activeSessionIdRef.current}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectMeta: { ...(cur?.projectMeta || {}), agentRole: newRole },
        }),
      }).catch(() => {});
    }
  }, [sessions]);

  const persistSessionQueue = useCallback((sid, q) => {
    if (!sid) return;
    const cur = sessions.find((s) => s.id === sid);
    fetch(`/api/chat/sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectMeta: { ...(cur?.projectMeta || {}), queuedMessages: q },
      }),
    }).catch(() => {});
  }, [sessions]);

  const handleImageClick = useCallback((src, name) => {
    setImagePreview({ src, name });
  }, []);

  const handleCopy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, []);

  // Debounced auto-save draft to IndexedDB
  useEffect(() => {
    if (!activeSessionId) return;
    const timer = setTimeout(() => {
      setCachedDraft(activeSessionId, draft, attachments);
    }, 500);
    return () => clearTimeout(timer);
  }, [activeSessionId, draft, attachments]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.agentRole", agentRole);
    } catch {}
  }, [agentRole]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.accessMode", accessMode);
    } catch {}
  }, [accessMode]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.maxSteps", String(maxSteps));
    } catch {}
  }, [maxSteps]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.viewMode", viewMode);
    } catch {}
  }, [viewMode]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem("chat.reasoningEffort", reasoningEffort);
    } catch {}
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

  const activeSessionCodebase = useMemo(
    () => activeSession?.workspacePath || activeSession?.codebase || "",
    [activeSession?.workspacePath, activeSession?.codebase]
  );

  const activeQueue = useMemo(
    () => sessionQueues[activeSessionId] || [],
    [sessionQueues, activeSessionId]
  );

  const sortedSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? sessions.filter(
          (s) =>
            (s.title || "").toLowerCase().includes(q) ||
            (s.model || "").toLowerCase().includes(q)
        )
      : [...sessions];

    return list.sort((a, b) => {
      const aPinned = !!a.pinned;
      const bPinned = !!b.pinned;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [sessions, search]);

  const params = { ...DEFAULT_PARAMS, ...(activeSession?.params || {}) };
  const canSend =
    !isSessionLoading &&
    !!activeSession?.model &&
    !!apiKey &&
    (draft.trim().length > 0 || attachments.length > 0);
  const commandOptions = useMemo(() => commandMatches(draft, shortcodes), [draft, shortcodes]);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  const handleTranscriptScroll = useCallback((event) => {
    const el = event.currentTarget;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    isAtBottomRef.current = atBottom;
    setShowScrollBottomBtn(!atBottom);
  }, []);

  const handleJumpToBottom = useCallback(() => {
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    scrollToBottom(true);
  }, [scrollToBottom]);

  const loadSessions = useCallback(async (preferId) => {
    const res = await fetch("/api/chat/sessions?limit=200");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load sessions");
    let list = data.sessions || [];

    const urlId = urlSessionId || (() => {
      try {
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          return params.get("sessionId") || params.get("session") || "";
        }
      } catch {}
      return "";
    })();

    const targetCandidate = preferId || urlSessionId || urlId || "";
    if (targetCandidate && !list.some((s) => s.id === targetCandidate)) {
      try {
        const singleRes = await fetch(`/api/chat/sessions/${targetCandidate}`);
        if (singleRes.ok) {
          const singleData = await singleRes.json().catch(() => null);
          if (singleData?.id) {
            list = [singleData, ...list];
          }
        }
      } catch {}
    }

    setSessions(list);
    const initialQueues = {};
    for (const s of list) {
      const q = Array.isArray(s.projectMeta?.queuedMessages) ? s.projectMeta.queuedMessages : [];
      if (q.length > 0) {
        initialQueues[s.id] = q;
      }
    }
    if (Object.keys(initialQueues).length > 0) {
      setSessionQueues((prev) => ({ ...initialQueues, ...prev }));
    }
    const storedId = (() => {
      try {
        return globalThis.localStorage?.getItem("chat.activeSessionId") || "";
      } catch {
        return "";
      }
    })();
    const nextId = (targetCandidate && list.some((s) => s.id === targetCandidate) ? targetCandidate : "") ||
                   (storedId && list.some((s) => s.id === storedId) ? storedId : "") ||
                   activeSessionId ||
                   list[0]?.id || "";
    if (nextId && (!activeSessionId || !list.some((s) => s.id === activeSessionId) || targetCandidate)) {
      activeSessionIdRef.current = nextId;
      setActiveSessionId(nextId);
      try {
        globalThis.localStorage?.setItem("chat.activeSessionId", nextId);
      } catch {}
    }
    return list;
  }, [activeSessionId, urlSessionId]);

  const loadSessionDetail = useCallback(async (id) => {
    if (!id) {
      setMessages([]);
      setTasks([]);
      setTeamRoster([]);
      setTeamTasks([]);
      setTeamMessages([]);
      setSubAgents([]);
      return null;
    }
    const res = await fetch(`/api/chat/sessions/${id}?limit=1000`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load session");

    setSessions((prev) => {
      const exists = prev.some((s) => s.id === id);
      if (exists) {
        return prev.map((s) => (s.id === id ? { ...s, ...data, messages: undefined } : s));
      }
      return [{ ...data, messages: undefined }, ...prev];
    });

    if (activeSessionIdRef.current !== id) return data;
    if (data.contextTokens != null) setCtxUsed(data.contextTokens);
    const msgs = data.messages || [];
    setMessages(msgs);
    setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    const team = data.teamState || {};
    const isLive = isRunActiveFor(id);
    const rosterList = (Array.isArray(team.roster) ? team.roster : []).map((m) =>
      !isLive && m.status === "running" ? { ...m, status: "idle" } : m
    );
    setTeamRoster(rosterList);
    setTeamTasks(Array.isArray(team.tasks) ? team.tasks : []);
    setTeamMessages(Array.isArray(team.messages) ? team.messages : []);
    setSubAgents((prev) => prev.filter((a) => a.sessionId === id));
    if (data.projectMeta?.agentRole) {
      setAgentRole(data.projectMeta.agentRole);
    } else {
      const defaultRole = globalThis.localStorage?.getItem("chat.agentRole") || "orchestrator";
      setAgentRole(defaultRole);
    }
    const effectiveCode = data.workspacePath || data.codebase || "";
    setCodebase(effectiveCode);
    setCodebaseValue(effectiveCode);
    const savedQueue = Array.isArray(data.projectMeta?.queuedMessages) ? data.projectMeta.queuedMessages : [];
    if (savedQueue.length > 0) {
      setSessionQueues((prev) => ({
        ...prev,
        [id]: prev[id]?.length ? prev[id] : savedQueue,
      }));
    }

    // Persist transcript cache to IndexedDB
    setCachedTranscript(id, {
      messages: msgs,
      tasks: data.tasks || [],
      teamState: data.teamState || null,
    }).catch(() => {});

    return data;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeChatRun((run) => {
      if (!mountedRef.current) return;
      setRunningSessionIds((prev) => {
        const clientIds = getActiveRunSessions();
        const next = new Set([...prev, ...clientIds]);
        if (run && !run.isSending && run.sessionId) {
          next.delete(run.sessionId);
        }
        return next;
      });
      if (!run || run.sessionId !== activeSessionIdRef.current) return;
      setMessages(run.messages || []);
      setIsSending(!!run.isSending);
      setAgentStatus(run.agentStatus || "");
      if (run.error) setError(run.error);
    });

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
                        segments: updateOrAppendSegment(m.segments, "text", content),
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
                messages: (getChatRun(existingSessionId)?.messages || []).map((m) =>
                  m.id === existing.assistantId
                    ? { ...m, reasoning, segments: updateOrAppendSegment(m.segments, "reasoning", reasoning) }
                    : m
                ),
              });
            } else if (event.type === "usage") {
              const used = Number(data.context_tokens || data.input_tokens || data.prompt_tokens || 0);
              const win = Number(data.context_window || 0);
              if (used > 0) {
                setCtxUsed(used);
                setSessions((prev) => prev.map((item) => item.id === existingSessionId ? { ...item, contextTokens: used } : item));
              }
              if (win > 0) setCtxWindow(win);
            } else if (event.type === "task_update") {
              patchChatRun(existingSessionId, { tasks: data.items || [] });
              if (activeSessionIdRef.current === existingSessionId) {
                setTasks(data.items || []);
              }
            } else if (event.type === "team_roster_update") {
              patchChatRun(existingSessionId, { teamRoster: data.roster || [] });
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamRoster(data.roster || []);
              }
            } else if (event.type === "team_tasks_update") {
              patchChatRun(existingSessionId, { teamTasks: data.tasks || [] });
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamTasks(data.tasks || []);
              }
            } else if (event.type === "team_message") {
              const nextMsg = { ...data, type: "message", id: `msg_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: event.createdAt || new Date().toISOString() };
              const prevMsgs = getChatRun(existingSessionId)?.teamMessages || [];
              patchChatRun(existingSessionId, { teamMessages: [...prevMsgs, nextMsg] });
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamMessages((prev) => [...prev, nextMsg]);
              }
            } else if (event.type === "team_broadcast") {
              const nextBc = { ...data, type: "broadcast", id: `bc_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: data.timestamp || event.createdAt || new Date().toISOString() };
              const prevMsgs = getChatRun(existingSessionId)?.teamMessages || [];
              patchChatRun(existingSessionId, { teamMessages: [...prevMsgs, nextBc] });
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamMessages((prev) => [...prev, nextBc]);
              }
            } else if (event.type === "approval") {
              const approvalItem = { ...data, sessionId: existingSessionId, runId: existing.runId };
              setApprovals((prev) => [...prev.filter((item) => item.id !== data.id), approvalItem]);
              if (activeSessionIdRef.current === existingSessionId) {
                setAgentStatus(`Waiting for approval: ${data.tool || "tool"}`);
              }
            } else if (event.type === "ask") {
              const askItem = { ...data, sessionId: existingSessionId, runId: existing.runId };
              setAsks((prev) => [...prev.filter((item) => item.id !== data.id), askItem]);
              if (activeSessionIdRef.current === existingSessionId) {
                setAgentStatus("Waiting for your answer…");
              }
            } else if (event.type === "subagent_start") {
              const subObj = { ...data, sessionId: existingSessionId, status: "running" };
              setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), subObj]);
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamRoster((prev) => prev.map((m) => m.name === data.role ? { ...m, status: "running" } : m));
              }
            } else if (event.type === "subagent_done") {
              const subDoneObj = { ...data, sessionId: existingSessionId, status: data.error ? "failed" : "completed" };
              setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...subDoneObj } : item));
              if (activeSessionIdRef.current === existingSessionId) {
                setTeamRoster((prev) => prev.map((m) => m.name === data.role ? { ...m, status: data.error ? "failed" : "idle" } : m));
              }
            } else if (event.type === "tool_start" || event.type === "tool_result") {
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
              stopRunTransport(existing.runId);
              liveRunRef.current.delete(existing.runId);
              setApprovals((prev) => prev.filter((item) => item.sessionId !== existingSessionId));
              setAsks((prev) => prev.filter((item) => item.sessionId !== existingSessionId));
              if (mountedRef.current && activeSessionIdRef.current === existing.sessionId) {
                setMessages(finalMessages);
                setIsSending(false);
                setAgentStatus("");
                if (event.type === "error") setError(data.message || "Chat failed");
              }
              setTimeout(() => {
                processNextQueuedMessage(existingSessionId);
              }, 300);
            }
          },
        };
        liveRunRef.current.set(existing.runId, liveCtx);
      }
      connectRunSocket(existing.runId, 0, liveRunRef.current.get(existing.runId));
    }
    return () => {
      mountedRef.current = false;
      unsub();
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
        const urlId = (() => {
          try {
            if (typeof window !== "undefined") {
              const params = new URLSearchParams(window.location.search);
              return params.get("sessionId") || params.get("session") || "";
            }
          } catch {}
          return "";
        })();
        if (urlId && !list.some((s) => s.id === urlId)) {
          try {
            const singleRes = await fetch(`/api/chat/sessions/${urlId}`);
            if (singleRes.ok) {
              const singleData = await singleRes.json().catch(() => null);
              if (singleData?.id) {
                list = [singleData, ...list];
                setSessions(list);
              }
            }
          } catch {}
        }
        const storedId = (() => {
          try {
            return globalThis.localStorage?.getItem("chat.activeSessionId") || "";
          } catch {
            return "";
          }
        })();
        const validUrl = (urlSessionId && list.some((s) => s.id === urlSessionId) ? urlSessionId : null) || (urlId && list.some((s) => s.id === urlId) ? urlId : null);
        const validStored = storedId && list.some((s) => s.id === storedId) ? storedId : null;
        const bootId = validUrl || validStored || (activeSessionIdRef.current && list.some((s) => s.id === activeSessionIdRef.current) ? activeSessionIdRef.current : null) || list[0]?.id;
        fetch("/api/chat/mcp").then((r) => r.json()).then((d) => { if (!cancelled && d.servers) setMcpServers(d.servers); }).catch(() => {});
        fetch("/api/chat/shortcodes").then((r) => r.json()).then((d) => { if (!cancelled && d.shortcodes) setShortcodes(d.shortcodes); }).catch(() => {});
        if (!cancelled && bootId) {
          activeSessionIdRef.current = bootId;
          lastLoadedSessionIdRef.current = bootId;
          setActiveSessionId(bootId);
          try {
            globalThis.localStorage?.setItem("chat.activeSessionId", bootId);
          } catch {}
          const current = list.find((item) => item.id === bootId);
          if (current) setCodebase(current.workspacePath || current.codebase || "");
          const activeRun = getChatRun(bootId);
          if (activeRun?.isSending && activeRun.sessionId === bootId) {
            setMessages(activeRun.messages || []);
            setIsSending(true);
            setAgentStatus(activeRun.agentStatus || "");
            if (activeRun.teamRoster) setTeamRoster(activeRun.teamRoster);
            if (activeRun.teamTasks) setTeamTasks(activeRun.teamTasks);
            if (activeRun.teamMessages) setTeamMessages(activeRun.teamMessages);
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
    let alive = true;
    const fetchActiveRuns = async () => {
      try {
        const res = await fetch("/api/chat/runs");
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (alive && Array.isArray(data?.activeSessions)) {
          const clientActive = getActiveRunSessions();
          const serverActive = data.activeSessions;
          const merged = new Set([...clientActive, ...serverActive]);
          setRunningSessionIds(merged);
          runningSessionIdsRef.current = merged;

          const allQueueSids = Object.keys(sessionQueuesRef.current || {});
          for (const sid of allQueueSids) {
            const q = sessionQueuesRef.current[sid] || [];
            if (
              q.length > 0 &&
              !merged.has(sid) &&
              !isRunActiveFor(sid) &&
              !processingQueuesRef.current?.has(sid)
            ) {
              processNextQueuedMessage(sid);
            }
          }

          const curSid = activeSessionIdRef.current;
          if (curSid && isSendingRef.current && !serverActive.includes(curSid)) {
            fetch(`/api/chat/runs/${curSid}?bySession=1`)
              .then((r) => r.json())
              .then((d) => {
                if (!d.active) {
                  isSendingRef.current = false;
                  setIsSending(false);
                  setAgentStatus("");
                  clearChatRun(curSid);
                  loadSessionDetail(curSid).catch(() => {});
                  setTimeout(() => {
                    processNextQueuedMessage(curSid);
                  }, 300);
                }
              })
              .catch(() => {});
          }
        }
      } catch {}
    };
    fetchActiveRuns();
    const interval = setInterval(fetchActiveRuns, 3000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const run = getChatRun(activeSessionId);
      if (run?.isSending && !agentStatus) {
        const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
        setAgentStatus(`${roleLabel} running…`);
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isSending) {
      setLiveInfo((s) => ({ ...s, elapsed: 0 }));
      return undefined;
    }
    const id = setInterval(() => {
      setLiveInfo((s) => ({ ...s, elapsed: s.elapsed + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [isSending]);

  const syncActiveSessionRunState = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/chat/runs/${sessionId}?bySession=1`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.active) {
        setIsSending(false);
        setAgentStatus("");
        setRunningSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        return;
      }
      setRunningSessionIds((prev) => new Set([...prev, sessionId]));

      const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
      const statusText = `${roleLabel} running…`;

      startChatRun({
        sessionId,
        runId: data.runId,
        assistantId: data.assistantId,
        assistantText: data.assistantText || "",
        messages: data.messages || [],
        agentStatus: statusText,
        teamRoster: data.teamRoster || [],
        teamTasks: data.teamTasks || [],
        teamMessages: data.teamMessages || [],
      });

      if (activeSessionIdRef.current === sessionId) {
        setMessages(data.messages || []);
        if (Array.isArray(data.tasks) && data.tasks.length > 0) {
          setTasks(data.tasks);
        }
        if (Array.isArray(data.teamRoster) && data.teamRoster.length > 0) {
          setTeamRoster(data.teamRoster);
        }
        if (Array.isArray(data.teamTasks) && data.teamTasks.length > 0) {
          setTeamTasks(data.teamTasks);
        }
        if (Array.isArray(data.teamMessages) && data.teamMessages.length > 0) {
          setTeamMessages(data.teamMessages);
        }
        if (Array.isArray(data.subAgents)) {
          setSubAgents(data.subAgents.map((s) => ({ ...s, sessionId })));
        }
        if (Array.isArray(data.gates)) {
          const incomingApprovals = data.gates.filter((g) => g.kind === "approval");
          const incomingAsks = data.gates.filter((g) => g.kind === "ask");
          setApprovals((prev) => [
            ...prev.filter((i) => i.sessionId !== sessionId),
            ...incomingApprovals.map((g) => ({ ...g, sessionId, runId: data.runId })),
          ]);
          setAsks((prev) => [
            ...prev.filter((i) => i.sessionId !== sessionId),
            ...incomingAsks.map((g) => ({ ...g, sessionId, runId: data.runId })),
          ]);
        }
        setIsSending(true);
        setAgentStatus(statusText);
      }

      if (!liveRunRef.current.get(data.runId)) {
        let lastSeq = 0;
        let assistantText = data.assistantText || "";
        const liveCtx = {
          runId: data.runId,
          lastSeq: () => lastSeq,
          isActive: () => !!getChatRun(sessionId)?.isSending,
          applyEvent: (event) => {
            if (!event || event.seq <= lastSeq) return;
            lastSeq = event.seq;
            const eventData = event.data || {};
            updateLiveFromEvent(event, eventData, sessionId);
            if (event.type === "text") {
              assistantText = eventData.content || assistantText;
              const currentRun = getChatRun(sessionId);
              const currentMsgs = currentRun?.messages || messagesRef.current || [];
              const next = currentMsgs.map((m) =>
                m.id === data.assistantId
                  ? {
                      ...m,
                      content: assistantText,
                      segments: updateOrAppendSegment(m.segments, "text", assistantText),
                      status: "streaming",
                    }
                  : m
              );
              patchChatRun(sessionId, { assistantText, messages: next });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
              }
            } else if (event.type === "reasoning") {
              const reasoning = eventData.content || "";
              const currentRun = getChatRun(sessionId);
              const currentMsgs = currentRun?.messages || messagesRef.current || [];
              const next = currentMsgs.map((m) => {
                if (m.id !== data.assistantId) return m;
                const segments = updateOrAppendSegment(m.segments, "reasoning", reasoning, { timestamp: new Date().toISOString() });
                return { ...m, reasoning, segments };
              });
              patchChatRun(sessionId, { messages: next });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
              }
            } else if (event.type === "message" && eventData.role === "assistant") {
              assistantText = eventData.content || assistantText;
              const currentRun = getChatRun(sessionId);
              const currentMsgs = currentRun?.messages || messagesRef.current || [];
              const next = currentMsgs.map((m) =>
                m.id === data.assistantId
                  ? {
                      ...m,
                      content: assistantText,
                      tool_calls: eventData.tool_calls || m.tool_calls || null,
                      status: eventData.tool_calls?.length ? "tool_calls" : "streaming",
                    }
                  : m
              );
              patchChatRun(sessionId, { assistantText, messages: next });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
              }
            } else if (event.type === "status") {
              const roleLabel = AGENT_ROLES.find((r) => r.id === agentRole)?.label || "Agent";
              const detail =
                eventData.phase === "thinking"
                  ? `thinking (step ${eventData.step || "?"})`
                  : eventData.phase === "init"
                    ? `workspace ${eventData.workspace || "…"}`
                    : eventData.phase || "working";
              const statusStr = `${roleLabel} ${detail}…`;
              patchChatRun(sessionId, { agentStatus: statusStr });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setAgentStatus(statusStr);
              }
            } else if (event.type === "tool_start") {
              const toolTime = new Date().toISOString();
              const currentRun = getChatRun(sessionId);
              const currentMsgs = currentRun?.messages || messagesRef.current || [];
              const updatedWithSegment = currentMsgs.map((m) =>
                m.id === data.assistantId
                  ? { ...m, segments: [...(m.segments || []), { type: "tool", callId: eventData.id, name: eventData.name, arguments: eventData.arguments, status: "running", timestamp: toolTime }] }
                  : m
              );
              const toolMsg = {
                id: eventData.id || createId(),
                role: "tool",
                tool_call_id: eventData.id,
                name: eventData.name,
                content: JSON.stringify({ status: "running", arguments: eventData.arguments }),
                status: "running",
                createdAt: toolTime,
              };
              const next = [...updatedWithSegment, toolMsg];
              const toolStatus = `Tool: ${eventData.name}…`;
              patchChatRun(sessionId, { messages: next, agentStatus: toolStatus });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
                setAgentStatus(toolStatus);
              }
            } else if (event.type === "tool_result") {
              const toolTime = new Date().toISOString();
              const nextTool = {
                id: data.id || createId(),
                role: "tool",
                tool_call_id: data.id,
                name: data.name,
                content: data.content,
                status: "done",
                createdAt: toolTime,
              };
              const index = currentMsgs.findIndex(
                (m) => m.role === "tool" && m.tool_call_id === eventData.id && m.status === "running"
              );
              const base = index >= 0
                ? currentMsgs.map((m, i) => (i === index ? nextTool : m))
                : [...currentMsgs, nextTool];
              const next = base.map((m) =>
                m.id === data.assistantId
                  ? { ...m, segments: (m.segments || []).map((seg) => seg.type === "tool" && seg.callId === eventData.id ? { ...seg, content: eventData.content, status: "done" } : seg) }
                  : m);
              const toolDoneStatus = `Tool done: ${eventData.name}`;
              patchChatRun(sessionId, { messages: next, agentStatus: toolDoneStatus });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
                setAgentStatus(toolDoneStatus);
              }
              loadSessionDetail(sessionId).catch(() => {});
            } else if (event.type === "tool_progress") {
              const currentRun = getChatRun(sessionId);
              const currentMsgs = currentRun?.messages || messagesRef.current || [];
              const next = currentMsgs.map((m) =>
                m.id === data.assistantId
                  ? { ...m, segments: (m.segments || []).map((seg) => seg.type === "tool" && seg.callId === eventData.id ? { ...seg, progress: (seg.progress || "") + (eventData.chunk || "") } : segment) }
                  : m
              );
              patchChatRun(sessionId, { messages: next });
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(next);
              }
            } else if (event.type === "usage") {
              const used = Number(eventData.context_tokens || eventData.input_tokens || eventData.prompt_tokens || 0);
              const win = Number(eventData.context_window || 0);
              if (used > 0) {
                setCtxUsed(used);
                setSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, contextTokens: used } : item));
              }
              if (win > 0) setCtxWindow(win);
            } else if (event.type === "task_update") {
              patchChatRun(sessionId, { tasks: eventData.items || [] });
              if (activeSessionIdRef.current === sessionId) {
                setTasks(eventData.items || []);
              }
            } else if (event.type === "approval") {
              const approvalItem = { ...eventData, sessionId, runId: data.runId };
              setApprovals((prev) => [...prev.filter((item) => item.id !== eventData.id), approvalItem]);
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setAgentStatus(`Waiting for approval: ${eventData.tool || "tool"}`);
              }
            } else if (event.type === "ask") {
              const askItem = { ...eventData, sessionId, runId: data.runId };
              setAsks((prev) => [...prev.filter((item) => item.id !== eventData.id), askItem]);
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setAgentStatus("Waiting for your answer…");
              }
            } else if (event.type === "subagent_start") {
              const subStart = { ...data, sessionId, status: "running" };
              setSubAgents((prev) => [...prev.filter((item) => item.id !== eventData.id), subStart]);
              if (activeSessionIdRef.current === sessionId) {
                setTeamRoster((prev) => prev.map((m) => m.name === eventData.role ? { ...m, status: "running" } : m));
              }
            } else if (event.type === "subagent_done") {
              const subDone = { ...eventData, sessionId, status: eventData.error ? "failed" : "completed" };
              setSubAgents((prev) => prev.map((item) => item.id === eventData.id ? { ...item, ...subDone } : item));
              if (activeSessionIdRef.current === sessionId) {
                setTeamRoster((prev) => prev.map((m) => m.name === eventData.role ? { ...m, status: eventData.error ? "failed" : "idle" } : m));
              }
            } else if (event.type === "notice") {
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setAgentStatus(eventData.message || "Working…");
                if (/^(MCP .+ unavailable:|Self-improvement (updated|skipped|failed):)/.test(eventData.message || "")) {
                  setNotice(eventData.message, eventData.message.startsWith("MCP ") || eventData.message.startsWith("Self-improvement failed:") ? "warning" : "info");
                }
              }
            } else if (event.type === "team_roster_update") {
              patchChatRun(sessionId, { teamRoster: eventData.roster || [] });
              if (activeSessionIdRef.current === sessionId) {
                setTeamRoster(eventData.roster || []);
              }
            } else if (event.type === "team_tasks_update") {
              patchChatRun(sessionId, { teamTasks: eventData.tasks || [] });
              if (activeSessionIdRef.current === sessionId) {
                setTeamTasks(eventData.tasks || []);
              }
            } else if (event.type === "team_message") {
              const nextMsg = { ...eventData, type: "message", id: `msg_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: event.createdAt || new Date().toISOString() };
              const prevMsgs = getChatRun(sessionId)?.teamMessages || [];
              patchChatRun(sessionId, { teamMessages: [...prevMsgs, nextMsg] });
              if (activeSessionIdRef.current === sessionId) {
                setTeamMessages((prev) => [...prev, nextMsg]);
              }
            } else if (event.type === "team_broadcast") {
              const nextBc = { ...eventData, type: "broadcast", id: `bc_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: eventData.timestamp || event.createdAt || new Date().toISOString() };
              const prevMsgs = getChatRun(sessionId)?.teamMessages || [];
              patchChatRun(sessionId, { teamMessages: [...prevMsgs, nextBc] });
              if (activeSessionIdRef.current === sessionId) {
                setTeamMessages((prev) => [...prev, nextBc]);
              }
            } else if (event.type === "done" || event.type === "error") {
              const finalMessages = eventData.messages || getChatRun(sessionId)?.messages || [];
              patchChatRun(sessionId, {
                messages: finalMessages,
                assistantText: eventData.finalText || eventData.message || "",
                isSending: false,
                agentStatus: "",
                error: event.type === "error" ? eventData.message || "Chat failed" : "",
              });
              clearChatRun(sessionId);
              stopRunTransport(data.runId);
              liveRunRef.current.delete(data.runId);
              setRunningSessionIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
              setApprovals((prev) => prev.filter((item) => item.sessionId !== sessionId));
              setAsks((prev) => prev.filter((item) => item.sessionId !== sessionId));
              if (mountedRef.current && activeSessionIdRef.current === sessionId) {
                setMessages(finalMessages);
                setIsSending(false);
                setAgentStatus("");
                if (event.type === "error") setError(eventData.message || "Chat failed");
              }
              setTimeout(() => {
                processNextQueuedMessage(sessionId);
              }, 300);
            }
          },
        };
        liveRunRef.current.set(data.runId, liveCtx);
      }
      connectRunSocket(data.runId, 0, liveRunRef.current.get(data.runId));
    } catch {}
  }, [agentRole, loadSessionDetail]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (lastLoadedSessionIdRef.current === activeSessionId) return;
    lastLoadedSessionIdRef.current = activeSessionId;
    activeSessionIdRef.current = activeSessionId;
    try {
      globalThis.localStorage?.setItem("chat.activeSessionId", activeSessionId);
    } catch {}
    const current = sessionsRef.current.find((s) => s.id === activeSessionId);
    const currentPath = current?.workspacePath || current?.codebase || "";
    setCodebase(currentPath);
    setCodebaseValue(currentPath);
    const run = getChatRun(activeSessionId);
    if (run?.isSending && run.sessionId === activeSessionId) {
      setMessages(run.messages || []);
      setIsSending(true);
      setAgentStatus(run.agentStatus || "");
      if (Array.isArray(run.teamRoster) && run.teamRoster.length > 0) setTeamRoster(run.teamRoster);
      if (Array.isArray(run.teamTasks) && run.teamTasks.length > 0) setTeamTasks(run.teamTasks);
      if (Array.isArray(run.teamMessages) && run.teamMessages.length > 0) setTeamMessages(run.teamMessages);
      setSubAgents((prev) => prev.filter((a) => a.sessionId === activeSessionId));
      setIsSessionLoading(false);
      return;
    }
    setIsSending(false);
    setAgentStatus("");
    setIsSessionLoading(true);
    setMessages([]);
    loadSessionDetail(activeSessionId)
      .then(() => {
        if (activeSessionIdRef.current === activeSessionId) {
          syncActiveSessionRunState(activeSessionId);
        }
      })
      .catch((e) => {
        if (activeSessionIdRef.current === activeSessionId) {
          setError(textValue(e.message));
        }
      })
      .finally(() => {
        if (activeSessionIdRef.current === activeSessionId) {
          setIsSessionLoading(false);
        }
      });
  }, [activeSessionId, loadSessionDetail, syncActiveSessionRunState]);

  useEffect(() => {
    const targetPath = activeSessionCodebase && /^[A-Za-z]:[\\/]|^[\\/]|^..?[\\/]/i.test(activeSessionCodebase) ? activeSessionCodebase : null;
    if (!targetPath) {
      setProjectInfo(null);
      return;
    }
    fetch("/api/chat/projects/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath }),
    }).then((res) => res.json()).then(setProjectInfo).catch(() => setProjectInfo(null));
  }, [activeSessionCodebase]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom(false);
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    const timer = setTimeout(() => {
      scrollToBottom(false);
    }, 60);
    return () => clearTimeout(timer);
  }, [activeSessionId, scrollToBottom]);

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

  const openEditModal = useCallback((session) => {
    setSessionModalMode("edit");
    setSessionFormName(session.title || "");
    setSessionFormUrl(session.workspacePath || session.codebase || "");
    setSessionFormEditId(session.id);
    setSessionModalOpen(true);
  }, []);

  const saveSessionModal = async () => {
    const name = sessionFormName.trim();
    const url = sessionFormUrl.trim();
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
      } catch {}
    }
    try {
      if (sessionModalMode === "edit" && sessionFormEditId) {
        await patchSession(sessionFormEditId, { title: name || "New chat", codebase: url, workspacePath, projectMeta });
        setCodebase(workspacePath || url);
        setCodebaseValue(workspacePath || url);
        setSessions((prev) => prev.map((s) => s.id === sessionFormEditId ? { ...s, title: name || "New chat", codebase: url, workspacePath, projectMeta } : s));
        if (workspacePath) {
          setProjectInfo({ workspacePath, name: projectMeta.name, scripts: {}, packageName: projectMeta.packageName });
          setProjectOpen(true);
          try { globalThis.localStorage?.setItem("chat.projectOpen", "true"); } catch {}
        }
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
        activeSessionIdRef.current = data.id;
        lastLoadedSessionIdRef.current = data.id;
        setIsSessionLoading(false);
        setCodebase(workspacePath || url);
        setCodebaseValue(workspacePath || url);
        setMessages([]);
        setDraft("");
        setAttachments([]);
        setTasks([]);
        setTeamRoster([]);
        setTeamTasks([]);
        setTeamMessages([]);
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
          codebase: "",
          workspacePath: "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create session");
      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      activeSessionIdRef.current = data.id;
      lastLoadedSessionIdRef.current = data.id;
      setIsSessionLoading(false);
      setCodebase("");
      setCodebaseValue("");
      setMessages([]);
      setDraft("");
      setAttachments([]);
      setTasks([]);
      setTeamRoster([]);
      setTeamTasks([]);
      setTeamMessages([]);
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  // ponytail: in-memory isSessionLoading flag covers instant transitions; add abort controller cancellation if session payload exceeds 5MB.
  const handleSelectSession = useCallback((id, force = false) => {
    if (!id) return;
    if (!force && id === activeSessionIdRef.current && !isSessionLoadingRef.current) return;
    isAtBottomRef.current = true;
    setShowScrollBottomBtn(false);
    activeSessionIdRef.current = id;
    lastLoadedSessionIdRef.current = id;
    setActiveSessionId(id);
    setIsSessionLoading(true);
    setMessages([]);

    try {
      globalThis.localStorage?.setItem("chat.activeSessionId", id);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("sessionId", id);
        url.searchParams.delete("session");
        window.history.replaceState(null, "", url.toString());
      }
    } catch {}

    const targetSession = sessionsRef.current.find((s) => s.id === id);
    const targetPath = targetSession?.workspacePath || targetSession?.codebase || "";
    setCodebase(targetPath);
    setCodebaseValue(targetPath);
    setError("");
    if (targetSession?.contextTokens != null) {
      setCtxUsed(targetSession.contextTokens);
    }

    getCachedDraft(id).then((cachedDraft) => {
      if (activeSessionIdRef.current === id) {
        if (cachedDraft?.draft || cachedDraft?.attachments?.length) {
          setDraft(cachedDraft.draft || "");
          setAttachments(cachedDraft.attachments || []);
        } else {
          setDraft("");
          setAttachments([]);
        }
      }
    }).catch(() => {});

    const run = getChatRun(id);
    const targetHasAsk = (asksRef.current || []).some((a) => a.sessionId === id);
    const targetHasApproval = (approvalsRef.current || []).some((a) => a.sessionId === id);
    setLiveInfo((s) => ({
      ...s,
      waiting: targetHasAsk || targetHasApproval,
      notice: "",
    }));

    if (run?.isSending && run.sessionId === id) {
      setMessages(run.messages || []);
      setIsSending(true);
      setAgentStatus(run.agentStatus || "");
      if (Array.isArray(run.teamRoster) && run.teamRoster.length > 0) setTeamRoster(run.teamRoster);
      if (Array.isArray(run.teamTasks) && run.teamTasks.length > 0) setTeamTasks(run.teamTasks);
      if (Array.isArray(run.teamMessages) && run.teamMessages.length > 0) setTeamMessages(run.teamMessages);
      setSubAgents((prev) => prev.filter((a) => a.sessionId === id));
      setIsSessionLoading(false);
    } else {
      setIsSending(false);
      setAgentStatus("");
      loadSessionDetail(id)
        .then(() => {
          if (activeSessionIdRef.current === id) {
            syncActiveSessionRunState(id);
          }
        })
        .catch(async (e) => {
          if (activeSessionIdRef.current === id) {
            try {
              const cached = await getCachedTranscript(id);
              if (activeSessionIdRef.current === id && cached?.messages?.length) {
                setMessages(cached.messages);
                if (cached.tasks) setTasks(cached.tasks);
                if (cached.teamState?.roster) setTeamRoster(cached.teamState.roster);
                if (cached.teamState?.tasks) setTeamTasks(cached.teamState.tasks);
                if (cached.teamState?.messages) setTeamMessages(cached.teamState.messages);
              }
            } catch {}
            setError(textValue(e.message));
          }
        })
        .finally(() => {
          if (activeSessionIdRef.current === id) {
            setIsSessionLoading(false);
          }
        });
    }
  }, [loadSessionDetail, syncActiveSessionRunState]);

  useEffect(() => {
    // useSearchParams does not follow our history.replaceState, so urlSessionId can be stale after a switch.
    // Read the live location first; fall back to the hook value only when it is empty.
    const liveSessionId = (() => {
      try {
        const params = new URLSearchParams(globalThis.window?.location?.search || "");
        return params.get("sessionId") || params.get("session") || "";
      } catch {
        return "";
      }
    })();
    const targetId = liveSessionId || urlSessionId;
    if (!targetId) return;
    if (targetId === activeSessionIdRef.current) return;

    let cancelled = false;
    const selectTarget = async () => {
      let target = sessionsRef.current.find((s) => s.id === targetId);
      if (!target) {
        try {
          const res = await fetch(`/api/chat/sessions/${targetId}`);
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data?.id && !cancelled) {
              target = data;
              setSessions((prev) => (prev.some((s) => s.id === data.id) ? prev : [data, ...prev]));
            }
          }
        } catch {}
      }
      if (!cancelled) {
        handleSelectSession(target?.id || targetId);
      }
    };

    selectTarget();
    return () => {
      cancelled = true;
    };
  }, [urlSessionId, handleSelectSession]);

  useEffect(() => {
    if (!urlWorkspace || urlSessionId) return;
    const match = sessions.find(
      (s) => s.workspacePath === urlWorkspace || s.codebase === urlWorkspace
    );
    if (match && match.id !== activeSessionIdRef.current) {
      handleSelectSession(match.id);
    }
  }, [urlWorkspace, urlSessionId, sessions, handleSelectSession]);

  const handleDeleteSession = useCallback((target) => {
    const sessionObj = typeof target === "object" && target !== null
      ? target
      : sessionsRef.current.find((s) => s.id === target) || (target ? { id: target, title: "Chat session" } : null);
    if (!sessionObj) return;
    setDeleteConfirmSession(sessionObj);
  }, []);

  const executeDeleteSession = useCallback(async () => {
    if (!deleteConfirmSession?.id) return;
    const id = deleteConfirmSession.id;
    setIsDeletingSession(true);
    try {
      const existingRun = getChatRun(id);
      const existingRunId = existingRun?.runId;
      if (existingRunId) {
        stopRunTransport(existingRunId);
        fetch(`/api/chat/runs/${existingRunId}`, { method: "DELETE" }).catch(() => {});
      }
      if (isRunActiveFor(id)) {
        abortChatRun(id);
        clearChatRun(id);
      }
      if (activeSessionIdRef.current === id) {
        abortRef.current?.abort();
        isSendingRef.current = false;
        setIsSending(false);
        setAgentStatus("");
      }

      const res = await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }

      deleteCachedTranscript(id);
      clearCachedDraft(id);

      setSessionQueues((prev) => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeSessionIdRef.current === id) {
          const fallback = next[0]?.id || "";
          if (fallback) {
            setTimeout(() => {
              handleSelectSession(fallback, true);
            }, 0);
          } else {
            setActiveSessionId("");
            activeSessionIdRef.current = "";
            lastLoadedSessionIdRef.current = "";
            setMessages([]);
            setTasks([]);
            setSubAgents([]);
            setTeamRoster([]);
            setTeamTasks([]);
            setTeamMessages([]);
            setIsSessionLoading(false);
            try {
              if (typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.searchParams.delete("sessionId");
                url.searchParams.delete("session");
                window.history.replaceState(null, "", url.toString());
              }
            } catch {}
          }
        }
        return next;
      });
      setDeleteConfirmSession(null);
    } catch (e) {
      setError(textValue(e.message));
    } finally {
      setIsDeletingSession(false);
    }
  }, [deleteConfirmSession, handleSelectSession]);

  const handleCopySession = useCallback(async (session) => {
    if (!session) return;
    try {
      setError("");
      const sessionName = session.title || "New chat";
      const workspacePath = session.workspacePath || session.codebase || "";
      const codebase = session.codebase || session.workspacePath || "";
      const { queuedMessages, ...cleanProjectMeta } = session.projectMeta || {};

      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sessionName,
          model: session.model || activeSession?.model || "",
          providerId: session.providerId || activeSession?.providerId || "",
          systemPrompt: session.systemPrompt || "",
          params: session.params || DEFAULT_PARAMS,
          codebase,
          workspacePath,
          projectMeta: cleanProjectMeta,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to copy session");

      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      activeSessionIdRef.current = data.id;
      lastLoadedSessionIdRef.current = data.id;
      setIsSessionLoading(false);
      try {
        globalThis.localStorage?.setItem("chat.activeSessionId", data.id);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("sessionId", data.id);
          url.searchParams.delete("session");
          window.history.replaceState(null, "", url.toString());
        }
      } catch {}

      setCodebase(workspacePath || codebase);
      setCodebaseValue(workspacePath || codebase);
      setMessages([]);
      setDraft("");
      setAttachments([]);
      setTasks([]);
      setSubAgents([]);
      setTeamRoster([]);
      setTeamTasks([]);
      setTeamMessages([]);
      if (cleanProjectMeta.agentRole) {
        setAgentRole(cleanProjectMeta.agentRole);
      }
      setNotice(`Duplicated session: ${sessionName}`, "success");
    } catch (e) {
      setError(textValue(e.message));
    }
  }, [activeSession?.model, activeSession?.providerId, setNotice, setError]);

  const handleRename = useCallback(async (id) => {
    const title = renameValue.trim();
    if (!title) return;
    try {
      await patchSession(id, { title });
      setRenameId("");
      setRenameValue("");
    } catch (e) {
      setError(textValue(e.message));
    }
  }, [renameValue]);

  const handleTogglePin = useCallback(async (session) => {
    try {
      await patchSession(session.id, { pinned: !session.pinned });
    } catch (e) {
      setError(textValue(e.message));
    }
  }, []);

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

  const handleStop = () => {
    abortChatRun(activeSessionId);
    abortRef.current?.abort();
    setApprovals((prev) => prev.filter((item) => item.sessionId !== activeSessionId));
    setAsks((prev) => prev.filter((item) => item.sessionId !== activeSessionId));
  };

  const stopRunTransport = (runId) => {
    if (runId) {
      const pTimer = pollTimerRef.current.get(runId);
      if (pTimer) { clearTimeout(pTimer); pollTimerRef.current.delete(runId); }
      const timer = reconnectTimerRef.current.get(runId);
      if (timer) { clearTimeout(timer); reconnectTimerRef.current.delete(runId); }
      const socket = websocketRef.current.get(runId);
      if (socket) {
        try { socket.onclose = null; socket.onerror = null; socket.close(); } catch {}
        websocketRef.current.delete(runId);
      }
      return;
    }
    for (const timer of pollTimerRef.current.values()) clearTimeout(timer);
    pollTimerRef.current.clear();
    for (const timer of reconnectTimerRef.current.values()) clearTimeout(timer);
    reconnectTimerRef.current.clear();
    for (const socket of websocketRef.current.values()) {
      try { socket.onclose = null; socket.onerror = null; socket.close(); } catch {}
    }
    websocketRef.current.clear();
  };

  const connectRunSocket = (runId, after = 0, ctx = null) => {
    if (!runId) return;
    stopRunTransport(runId);
    const live = ctx || liveRunRef.current.get(runId);
    if (!live) return;

    const startHttpPolling = () => {
      if (pollTimerRef.current.has(runId)) return;
      const poll = async () => {
        if (!live.isActive()) {
          pollTimerRef.current.delete(runId);
          return;
        }
        try {
          const currentAfter = live.lastSeq?.() || 0;
          const res = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}?after=${currentAfter}`);
          if (res.ok) {
            const runData = await res.json().catch(() => null);
            if (runData?.events?.length) {
              for (const ev of runData.events) {
                live.applyEvent(ev);
              }
            }
            const isEnded = !runData?.live || runData?.status === "completed" || runData?.status === "stopped" || runData?.status === "failed";
            if (runData && isEnded) {
              pollTimerRef.current.delete(runId);
              const hasDone = (runData.events || []).some((e) => e.type === "done" || e.type === "error");
              if (!hasDone) {
                live.applyEvent({
                  seq: 9999999,
                  type: runData.status === "failed" ? "error" : "done",
                  data: {
                    messages: runData.messages || runData.result?.messages,
                    finalText: runData.result?.finalText || runData.assistantText || "",
                    title: runData.result?.title,
                  },
                });
              }
              return;
            }
          }
        } catch {}
        if (live.isActive()) {
          const timer = setTimeout(poll, 1000);
          pollTimerRef.current.set(runId, timer);
        } else {
          pollTimerRef.current.delete(runId);
        }
      };
      const timer = setTimeout(poll, 500);
      pollTimerRef.current.set(runId, timer);
    };

    if (typeof WebSocket === "undefined") {
      startHttpPolling();
      return;
    }

    try {
      const protocol = globalThis.location?.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${protocol}://${globalThis.location.host}/api/chat/ws`);
      websocketRef.current.set(runId, socket);
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
        if (payload.type === "snapshot" && payload.run) {
          if (payload.run.events) {
            for (const event of payload.run.events) live?.applyEvent(event);
          }
          if (!payload.run.live || payload.run.status === "completed" || payload.run.status === "failed" || payload.run.status === "stopped") {
            const hasDoneEvent = (payload.run.events || []).some((e) => e.type === "done" || e.type === "error");
            if (!hasDoneEvent) {
              live?.applyEvent({
                seq: 9999999,
                type: payload.run.status === "failed" ? "error" : "done",
                data: {
                  messages: payload.run.messages || payload.run.result?.messages,
                  finalText: payload.run.result?.finalText || payload.run.assistantText || "",
                  title: payload.run.result?.title,
                },
              });
            }
          }
          return;
        }
        const event = payload.type === "event" ? payload.event : null;
        if (!event || !live || live.runId !== runId) return;
        live.applyEvent(event);
      };
      socket.onerror = () => {
        startHttpPolling();
      };
      socket.onclose = () => {
        if (live && live.isActive()) {
          startHttpPolling();
          const timer = setTimeout(
            () => connectRunSocket(runId, live.lastSeq?.() || 0, live),
            2000
          );
          reconnectTimerRef.current.set(runId, timer);
        }
      };
    } catch {
      startHttpPolling();
    }
  };

  const applyUiIfActive = (sessionId, fn) => {
    if (!mountedRef.current) return;
    if (activeSessionIdRef.current !== sessionId) return;
    fn();
  };

  const updateLiveFromEvent = (event, data, eventSessionId) => {
    if (eventSessionId && activeSessionIdRef.current !== eventSessionId) return;
    if (event.type === "status") {
      const notice = data.phase === "thinking" ? "Thinking…" : "";
      setLiveInfo((s) => ({ ...s, turn: Number(data.step) || s.turn, notice, waiting: false }));
    } else if (event.type === "reasoning") {
      setLiveInfo((s) => ({ ...s, notice: "Thinking…", waiting: false }));
    } else if (event.type === "text") {
      setLiveInfo((s) => ({ ...s, notice: "", waiting: false }));
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
      if (/^(MCP .+ unavailable:|Self-improvement (updated|skipped|failed):)/.test(data.message || "")) {
        setNotice(data.message, data.message.startsWith("MCP ") || data.message.startsWith("Self-improvement failed:") ? "warning" : "info");
      }
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

    // Save to IndexedDB transcript cache
    setCachedTranscript(sessionId, {
      messages: finalMessages,
      tasks,
      teamState: { roster: teamRoster, tasks: teamTasks, messages: teamMessages },
    }).catch(() => {});

    patchChatRun(sessionId, {
      messages: finalMessages,
      assistantText: summary,
      isSending: false,
      agentStatus: "",
      error: errorText || "",
    });
    clearChatRun(sessionId);
    if (sessionId === activeSessionIdRef.current) {
      isSendingRef.current = false;
      setIsSending(false);
      setAgentStatus("");
    }
    setRunningSessionIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });

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
    setApprovals((prev) => prev.filter((item) => item.sessionId !== sessionId));
    setAsks((prev) => prev.filter((item) => item.sessionId !== sessionId));
    setTimeout(() => {
      processNextQueuedMessage(sessionId);
    }, 300);

    return finalMessages;
  };

  const removeFromQueue = (id) => {
    setSessionQueues((prev) => {
      const cur = prev[activeSessionId] || [];
      const next = cur.filter((item) => item.id !== id);
      persistSessionQueue(activeSessionId, next);
      return { ...prev, [activeSessionId]: next };
    });
  };

  const clearQueue = () => {
    setSessionQueues((prev) => {
      persistSessionQueue(activeSessionId, []);
      return { ...prev, [activeSessionId]: [] };
    });
  };

  const processNextQueuedMessage = useCallback((sid) => {
    const targetId = sid || activeSessionIdRef.current;
    if (!targetId) return;
    if (processingQueuesRef.current.has(targetId)) return;

    const curQueue = sessionQueuesRef.current[targetId] || [];
    if (curQueue.length === 0) return;

    if (
      isRunActiveFor(targetId) ||
      getChatRun(targetId)?.isSending ||
      runningSessionIdsRef.current.has(targetId)
    ) {
      return;
    }

    processingQueuesRef.current.add(targetId);
    const nextItem = curQueue[0];
    const remaining = curQueue.slice(1);
    setSessionQueues((prev) => {
      const updated = { ...prev, [targetId]: remaining };
      sessionQueuesRef.current = updated;
      persistSessionQueue(targetId, remaining);
      return updated;
    });

    if (nextItem && (nextItem.text || nextItem.attachments?.length)) {
      setTimeout(() => {
        try {
          sendMessageRef.current?.({ queuedItem: nextItem, force: true });
        } finally {
          setTimeout(() => {
            processingQueuesRef.current.delete(targetId);
          }, 600);
        }
      }, 120);
    } else {
      processingQueuesRef.current.delete(targetId);
    }
  }, [persistSessionQueue]);

  const runQueuedItemImmediately = useCallback(async (item) => {
    if (!item) return;
    const sid = item.sessionId || activeSessionIdRef.current;
    if (!sid) return;

    if (sid !== activeSessionIdRef.current) {
      handleSelectSession(sid);
    }

    const existingRun = getChatRun(sid);
    const existingRunId = existingRun?.runId;

    if (existingRunId) {
      stopRunTransport(existingRunId);
      fetch(`/api/chat/runs/${existingRunId}`, { method: "DELETE" }).catch(() => {});
    }
    abortChatRun(sid);
    abortRef.current?.abort();
    clearChatRun(sid);

    if (sid === activeSessionIdRef.current) {
      isSendingRef.current = false;
      setIsSending(false);
      setAgentStatus("");
    }

    setSessionQueues((prev) => {
      const cur = prev[sid] || [];
      const updated = cur.filter((x) => x.id !== item.id);
      sessionQueuesRef.current = { ...sessionQueuesRef.current, [sid]: updated };
      persistSessionQueue(sid, updated);
      return { ...prev, [sid]: updated };
    });

    setTimeout(() => {
      sendMessageRef.current?.({ queuedItem: item, force: true });
    }, 40);
  }, [persistSessionQueue, handleSelectSession]);

  const sendMessage = async ({ regenerate = false, sourceMessages = null, queuedItem = null, force = false, userText: overrideUserText = null } = {}) => {
    const sessionId = queuedItem?.sessionId || activeSessionIdRef.current;
    const targetSession = sessions.find((s) => s.id === sessionId) || activeSession;
    const modelToUse = targetSession?.model || activeSession?.model;
    if (!modelToUse) {
      setError("Select a model first.");
      return;
    }
    if (!apiKey) {
      setError("No API key. Create one in Endpoint & Key.");
      return;
    }

    if (!force && getChatRun(sessionId)?.isSending) {
      if (!regenerate && !queuedItem && (draft.trim() || attachments.length > 0)) {
        const item = {
          id: createId(),
          sessionId,
          text: draft.trim(),
          attachments: [...attachments],
          timestamp: new Date().toISOString(),
        };
        setSessionQueues((prev) => {
          const cur = prev[sessionId] || [];
          const next = [...cur, item];
          sessionQueuesRef.current = { ...sessionQueuesRef.current, [sessionId]: next };
          persistSessionQueue(sessionId, next);
          return { ...prev, [sessionId]: next };
        });
        setDraft("");
        setAttachments([]);
        clearCachedDraft(sessionId);
        setError("Message queued for this session. Will send automatically when current response finishes.");
        return;
      }
      if (queuedItem) {
        setSessionQueues((prev) => {
          const cur = prev[sessionId] || [];
          const next = cur.some((x) => x.id === queuedItem.id) ? cur : [queuedItem, ...cur];
          sessionQueuesRef.current = { ...sessionQueuesRef.current, [sessionId]: next };
          persistSessionQueue(sessionId, next);
          return { ...prev, [sessionId]: next };
        });
        return;
      }
      setError("This session is already running. Stop it first or wait.");
      return;
    }

    if (force) {
      abortRef.current?.abort();
      clearChatRun(sessionId);
      if (sessionId === activeSessionIdRef.current) {
        isSendingRef.current = false;
        setIsSending(false);
      }
    }

    const isTargetActive = sessionId === activeSessionIdRef.current;
    const sessionMeta = {
      title: targetSession?.title || "Chat",
      model: modelToUse,
      providerId: targetSession?.providerId || activeSession?.providerId,
    };

    let baseMessages = sourceMessages;
    if (!baseMessages) {
      if (isTargetActive) {
        baseMessages = messagesRef.current || messages;
      } else {
        const runMsgs = getChatRun(sessionId)?.messages;
        if (runMsgs && runMsgs.length > 0) {
          baseMessages = runMsgs;
        } else {
          try {
            const res = await fetch(`/api/chat/sessions/${sessionId}?limit=1000`);
            const data = await res.json().catch(() => null);
            baseMessages = data?.messages || [];
          } catch {
            baseMessages = [];
          }
        }
      }
    }

    let workingMessages = [...(baseMessages || [])].map((m) =>
      m.role === "assistant" && m.status === "streaming"
        ? { ...m, status: "done", content: m.content || "(interrupted)" }
        : m
    );
    if (regenerate) {
      const lastUserIdx = [...workingMessages].map((m) => m.role).lastIndexOf("user");
      if (lastUserIdx < 0) return;
      workingMessages = workingMessages.slice(0, lastUserIdx + 1);
    } else {
      const userText = overrideUserText != null ? overrideUserText.trim() : (queuedItem ? (queuedItem.text || "").trim() : draft.trim());
      const userAttachments = queuedItem ? (queuedItem.attachments || []) : attachments;
      if (!userText && userAttachments.length === 0) return;
      const docList = userAttachments.filter((a) => a.docPath);
      let content = userText;
      if (docList.length > 0) {
        const note = docList.map((d) => `- ${d.name} (path: ${d.docPath})`).join("\n");
        content = content ? `${content}\n\nAttached file(s) — read each with the read_document tool before answering:\n${note}` : `Attached file(s) — read each with the read_document tool before answering:\n${note}`;
      }
      const userMessage = {
        id: createId(),
        role: "user",
        content,
        attachments: userAttachments.map((a) => ({
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
      if (isTargetActive && !queuedItem) {
        setDraft("");
        setAttachments([]);
        clearCachedDraft(sessionId);
      }
      if (userText) {
        setInputHistory((prev) => {
          const next = prev[0] === userText ? prev : [userText, ...prev.filter((x) => x !== userText)].slice(0, 50);
          try {
            globalThis.localStorage?.setItem("chat.inputHistory", JSON.stringify(next));
          } catch {}
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
    if (isTargetActive) {
      setMessages(workingMessages);
      setIsSending(true);
      setError("");
      isAtBottomRef.current = true;
      setShowScrollBottomBtn(false);
      setTimeout(() => scrollToBottom(true), 30);
    }
    const runAbortController = new AbortController();
    if (isTargetActive) {
      abortRef.current?.abort();
      abortRef.current = runAbortController;
    }

    const titleSeed = textValue(
      workingMessages.find((m) => m.role === "user")?.content || targetSession?.title || activeSession?.title
    );

    const targetRole = targetSession?.projectMeta?.agentRole || (isTargetActive ? agentRole : "orchestrator");
    const targetRoleObj = AGENT_ROLES.find((role) => role.id === targetRole) || AGENT_ROLES[0];
    const targetWorkspace = targetSession?.workspacePath || targetSession?.codebase || (isTargetActive ? activeSessionCodebase : "");
    const targetTeamRoster = targetSession?.teamState?.roster || (isTargetActive ? teamRoster : []);
    const targetTeamTasks = targetSession?.teamState?.tasks || (isTargetActive ? teamTasks : []);
    const targetTeamMessages = targetSession?.teamState?.messages || (isTargetActive ? teamMessages : []);

    setRunningSessionIds((prev) => new Set([...prev, sessionId]));
    runningSessionIdsRef.current.add(sessionId);

    startChatRun({
      sessionId,
      abortController: runAbortController,
      messages: workingMessages,
      assistantId,
      assistantText: "",
      agentStatus: `${targetRoleObj.label} starting…`,
      titleSeed,
      sessionMeta,
      teamRoster: targetTeamRoster,
      teamTasks: targetTeamTasks,
      teamMessages: targetTeamMessages,
    });

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

      setCachedTranscript(sessionId, {
        messages: finalMessages,
        tasks,
        teamState: { roster: teamRoster, tasks: teamTasks, messages: teamMessages },
      }).catch(() => {});

      patchChatRun(sessionId, {
        messages: finalMessages,
        assistantText: finalText,
        isSending: false,
        agentStatus: "",
        error: isError ? data.message || "Chat failed" : "",
      });
      clearChatRun(sessionId);
      if (sessionId === activeSessionIdRef.current) {
        isSendingRef.current = false;
        setIsSending(false);
        setAgentStatus("");
      }
      if (currentRunId) liveRunRef.current.delete(currentRunId);
      setRunningSessionIds((prev) => { const n = new Set(prev); n.delete(sessionId); return n; });
      runningSessionIdsRef.current.delete(sessionId);
      setApprovals((prev) => prev.filter((item) => item.sessionId !== sessionId));
      setAsks((prev) => prev.filter((item) => item.sessionId !== sessionId));
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
      setTimeout(() => {
        processNextQueuedMessage(sessionId);
      }, 300);
    };

    sendMessageRef.current = sendMessage;
    try {
      applyUiIfActive(sessionId, () => setAgentStatus(`${AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Agent"} starting…`));
      const response = await fetch("/api/chat/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          mode: "agent",
          agentRole: targetRole,
          providerId: sessionMeta.providerId,
          assistantId,
          titleSeed,
          persistedMessages: workingMessages,
          model: modelToUse,
          messages: requestMessages,
          systemPrompt: [
            targetRoleObj.prompt || "",
            targetSession?.systemPrompt || activeSession?.systemPrompt || "",
          ].filter(Boolean).join("\n\n"),
          apiKey,
          accessMode,
          verify: verifyMode,
          codebase: targetWorkspace,
          autoApprove,
          teamTasks: targetTeamTasks,
          teamRoster: targetTeamRoster,
          params: {
            temperature: targetSession?.params?.temperature ?? params.temperature,
            max_tokens: targetSession?.params?.max_tokens ?? params.max_tokens,
            top_p: targetSession?.params?.top_p ?? params.top_p,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          },
          maxSteps,
        }),
      });
      const started = await response.json().catch(() => ({}));
      if (!response.ok || !started.id) {
        throw new Error(started.error || "Unable to start background chat");
      }
      if (runAbortController.signal.aborted) {
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
          updateLiveFromEvent(event, data, sessionId);
          if (event.type === "text") {
            assistantText = data.content || assistantText;
            pushLive(
              liveMessages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: assistantText,
                      segments: updateOrAppendSegment(m.segments, "text", assistantText),
                      status: "streaming",
                    }
                  : m
              )
            );
          } else if (event.type === "reasoning") {
            const reasoning = data.content || "";
            pushLive(
              liveMessages.map((m) => {
                if (m.id !== assistantId) return m;
                const segments = updateOrAppendSegment(m.segments, "reasoning", reasoning, { timestamp: new Date().toISOString() });
                return { ...m, reasoning, segments };
              })
            );
          } else if (event.type === "message" && data.role === "assistant") {
            assistantText = data.content || assistantText;
            pushLive(
              liveMessages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: assistantText,
                      tool_calls: data.tool_calls || m.tool_calls || null,
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
            const toolTime = new Date().toISOString();
            const withSegment = liveMessages.map((m) => m.id === assistantId
              ? { ...m, segments: [...(m.segments || []), { type: "tool", callId: data.id, name: data.name, arguments: data.arguments, status: "running", timestamp: toolTime }] }
              : m);
            pushLive(
              [
                ...withSegment,
                {
                  id: data.id || createId(),
                  role: "tool",
                  tool_call_id: data.id,
                  name: data.name,
                  content: JSON.stringify({ status: "running", arguments: data.arguments }),
                  status: "running",
                  createdAt: toolTime,
                },
              ],
              `Tool: ${data.name}…`
            );
          } else if (event.type === "tool_result") {
            const toolTime = new Date().toISOString();
            const next = {
              id: data.id || createId(),
              role: "tool",
              tool_call_id: data.id,
              name: data.name,
              content: data.content,
              status: "done",
              createdAt: toolTime,
            };
            const index = liveMessages.findIndex(
              (m) => m.role === "tool" && m.tool_call_id === data.id && m.status === "running"
            );
            const updated = (index >= 0
              ? liveMessages.map((m, i) => (i === index ? next : m))
              : [...liveMessages, next]
            ).map((m) => m.id === assistantId
              ? { ...m, segments: (m.segments || []).map((segment) => segment.type === "tool" && segment.callId === data.id ? { ...segment, content: data.content, status: "done" } : segment) }
              : m);
            pushLive(updated, `Tool done: ${data.name}`);
          } else if (event.type === "usage") {
            const used = Number(data.context_tokens || data.input_tokens || data.prompt_tokens || 0);
            const win = Number(data.context_window || 0);
            if (used > 0) {
              setCtxUsed(used);
              setSessions((prev) => prev.map((item) => item.id === sessionId ? { ...item, contextTokens: used } : item));
            }
            if (win > 0) setCtxWindow(win);
          } else if (event.type === "task_update") {
            patchChatRun(sessionId, { tasks: data.items || [] });
            if (activeSessionIdRef.current === sessionId) {
              setTasks(data.items || []);
            }
          } else if (event.type === "team_roster_update") {
            patchChatRun(sessionId, { teamRoster: data.roster || [] });
            if (activeSessionIdRef.current === sessionId) {
              setTeamRoster(data.roster || []);
            }
          } else if (event.type === "team_tasks_update") {
            patchChatRun(sessionId, { teamTasks: data.tasks || [] });
            if (activeSessionIdRef.current === sessionId) {
              setTeamTasks(data.tasks || []);
            }
          } else if (event.type === "team_message") {
            const nextMsg = { ...data, type: "message", id: `msg_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: event.createdAt || new Date().toISOString() };
            const prevMsgs = getChatRun(sessionId)?.teamMessages || [];
            patchChatRun(sessionId, { teamMessages: [...prevMsgs, nextMsg] });
            if (activeSessionIdRef.current === sessionId) {
              setTeamMessages((prev) => [...prev, nextMsg]);
            }
          } else if (event.type === "team_broadcast") {
            const nextBc = { ...data, type: "broadcast", id: `bc_${Date.now()}_${Math.random().toString(16).slice(2,6)}`, timestamp: data.timestamp || event.createdAt || new Date().toISOString() };
            const prevMsgs = getChatRun(sessionId)?.teamMessages || [];
            patchChatRun(sessionId, { teamMessages: [...prevMsgs, nextBc] });
            if (activeSessionIdRef.current === sessionId) {
              setTeamMessages((prev) => [...prev, nextBc]);
            }
          } else if (event.type === "approval") {
            const approvalItem = { ...data, sessionId, runId: started.id };
            setApprovals((prev) => [...prev.filter((item) => item.id !== data.id), approvalItem]);
            if (activeSessionIdRef.current === sessionId) {
              setAgentStatus(`Waiting for approval: ${data.tool || "tool"}`);
            }
          } else if (event.type === "ask") {
            const askItem = { ...data, sessionId, runId: started.id };
            setAsks((prev) => [...prev.filter((item) => item.id !== data.id), askItem]);
            if (activeSessionIdRef.current === sessionId) {
              setAgentStatus("Waiting for your answer…");
            }
          } else if (event.type === "subagent_start") {
            const subStart = { ...eventData, sessionId, status: "running" };
            setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), subStart]);
            if (activeSessionIdRef.current === sessionId) {
              setTeamRoster((prev) => prev.map((m) => m.name === data.role ? { ...m, status: "running" } : m));
            }
          } else if (event.type === "subagent_done") {
            const subDone = { ...data, sessionId, status: data.error ? "failed" : "completed" };
            setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...subDone } : item));
            if (activeSessionIdRef.current === sessionId) {
              setTeamRoster((prev) => prev.map((m) => m.name === data.role ? { ...m, status: data.error ? "failed" : "idle" } : m));
            }
          } else if (event.type === "tool_progress") {
            pushLive(liveMessages.map((m) => m.id === assistantId
              ? { ...m, segments: (m.segments || []).map((segment) => segment.type === "tool" && segment.callId === data.id ? { ...segment, progress: (segment.progress || "") + (data.chunk || "") } : segment) }
              : m));
          } else if (event.type === "notice") {
            setAgentStatus(data.message || "Working…");
            if (/^(MCP .+ unavailable:|Self-improvement (updated|skipped|failed):)/.test(data.message || "")) {
              setNotice(data.message, data.message.startsWith("MCP ") || data.message.startsWith("Self-improvement failed:") ? "warning" : "info");
            }
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

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    const queue = sessionQueues[activeSessionId] || [];
    if (!isSending && queue.length > 0 && activeSession?.model && apiKey && activeSessionId) {
      const timer = setTimeout(() => {
        if (!isSendingRef.current && !getChatRun(activeSessionId)?.isSending && !runningSessionIdsRef.current.has(activeSessionId)) {
          processNextQueuedMessage(activeSessionId);
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isSending, sessionQueues, activeSessionId, activeSession?.model, apiKey, processNextQueuedMessage]);

  const handleKeyDown = (event) => {
    // Ctrl+` or Cmd+` toggles bottom terminal
    if ((event.ctrlKey || event.metaKey) && (event.key === "`" || event.key === "~")) {
      event.preventDefault();
      toggleTerminal();
      return;
    }

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
        if (command?.isShortcode) {
          setDraft(`/shortcode ${command.tag} `);
        } else if (command) {
          setDraft(`/${command.name}${command.args ? " " : ""}`);
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (commandOptions.length > 0 && commandOptions[commandIndex]?.isShortcode && draft.trim() === "/shortcode") {
        runCommand(`/shortcode ${commandOptions[commandIndex].tag}`);
        return;
      }
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
        const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
        if (curApprovals.length > 0) {
          event.preventDefault();
          resolveGate(curApprovals[0], "allow");
        }
        return;
      }
      if (event.key === "d" || event.key === "D") {
        const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
        if (curApprovals.length > 0) {
          event.preventDefault();
          resolveGate(curApprovals[0], "deny");
        }
        return;
      }
    }
  };

  const resolveGate = async (gate, outcome, always = false) => {
    let runId = gate.runId || (gate.sessionId ? getChatRun(gate.sessionId)?.runId : null) || getChatRun(activeSessionId)?.runId;
    if (!runId) {
      for (const [id, ctx] of liveRunRef.current.entries()) {
        if (ctx.isActive?.()) { runId = id; break; }
      }
    }
    if (!runId) { setError("No active run found for approval"); return; }
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
      activeSessionIdRef.current = data.id;
      lastLoadedSessionIdRef.current = data.id;
      setIsSessionLoading(false);
    }
    setMessages(data.messages || []);
    return data;
  };

  const saveCodebase = async () => {
    const value = codebaseValue.trim();
    try {
      await patchSession(activeSessionId, { codebase: value, workspacePath: value });
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
    } catch {}
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

  const handleEditMessage = useCallback(async (message) => {
    const nextText = globalThis.prompt?.("Edit message", textValue(message.content));
    if (nextText == null || !nextText.trim() || nextText.trim() === textValue(message.content).trim()) return;
    try {
      const data = await sessionAction("edit", { messageId: message.id, content: nextText.trim() });
      await sendMessage({ regenerate: true, sourceMessages: data.messages || [] });
    } catch (e) {
      setError(textValue(e.message));
    }
  }, []);

  const handleRegenerate = useCallback(() => {
    sendMessage({ regenerate: true });
  }, [activeSession?.model, apiKey]);

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
      else if (name === "copy" || name === "duplicate") {
        const current = sessions.find((s) => s.id === activeSessionId) || activeSession;
        if (!current) throw new Error("No active session to copy");
        await handleCopySession(current);
      }
      else if (name === "terminal") toggleTerminal();
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
        updateAgentRole(role.id);
      } else if (name === "agent-teams") {
        updateAgentRole("team");
        if (value) {
          await sendMessage({ userText: value });
        }
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
      } else if (name === "approve") {
        const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
        if (curApprovals.length === 0) throw new Error("No pending approval");
        await resolveGate(curApprovals[0], "allow");
        setError("Approval granted");
      } else if (name === "deny") {
        const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
        if (curApprovals.length === 0) throw new Error("No pending approval");
        await resolveGate(curApprovals[0], "deny");
        setError("Approval denied");
      } else if (name === "project") {
        if (!value) throw new Error("Usage: /project <absolute path>");
        const inspect = await fetch("/api/chat/projects/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: value }) });
        const data = await inspect.json().catch(() => ({}));
        if (!inspect.ok) throw new Error(data.error || "Unable to inspect project");
        await patchSession(activeSessionId, { workspacePath: data.workspacePath, codebase: data.workspacePath, projectMeta: { name: data.name, packageName: data.packageName } });
        setProjectInfo(data);
        setProjectOpen(true);
        try { globalThis.localStorage?.setItem("chat.projectOpen", "true"); } catch {}
        setPendingProject({ path: data.workspacePath, name: data.name });
      } else if (name === "codebase") {
        const current = sessions.find((s) => s.id === activeSessionId);
        if (current) openEditModal(current);
      } else if (name === "skills" || name === "skill") setSkillsModalOpen(true);
      else if (name === "shortcode" || name === "shortcodes") {
        if (!value) {
          setShortcodesModalOpen(true);
        } else {
          const [targetTag, ...rest] = value.split(/\s+/);
          const cleanTag = targetTag.toLowerCase().replace(/^\/+/, "");
          let found = shortcodes.find((sc) => sc.tag.toLowerCase() === cleanTag);
          if (!found) {
            try {
              const res = await fetch(`/api/chat/shortcodes?tag=${encodeURIComponent(cleanTag)}`);
              if (res.ok) {
                const data = await res.json().catch(() => null);
                if (data?.shortcode) found = data.shortcode;
              }
            } catch {}
          }
          if (!found) {
            throw new Error(`Shortcode "${cleanTag}" not found. Type /shortcode to view all.`);
          }
          const extra = rest.join(" ").trim();
          const expandedText = extra ? `${found.description}\n\n${extra}` : found.description;
          await sendMessage({ userText: expandedText });
        }
      }
      else if (name === "mcp") {
        await loadMcpServers();
        setMcpModalOpen(true);
      } else if (name === "verify") {
        setVerifyMode((v) => !v);
        setError(verifyMode ? "Verification disabled for next run" : "Verification enabled for next run");
      } else if (name === "compact") {
        try {
          const keepLastN = 20;
          const res = await fetch(`/api/chat/sessions/${activeSessionId}/compact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keepLastN }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Failed to compact session");
          await loadSessionDetail(activeSessionId);
          setError(`Session compacted: ${data.summarizedCount ?? data.deletedCount ?? 0} messages summarized into ${data.summaryChars ?? 0} chars, ${data.keptCount ?? keepLastN} kept verbatim`);
        } catch (e) {
          setError(textValue(e.message));
        }
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
      {/* Sessions rail component */}
      <ChatSessionRail
        sessions={sortedSessions}
        activeSessionId={activeSessionId}
        runningSessionIds={runningSessionIds}
        pendingAskSessionIds={pendingAskSessionIds}
        search={search}
        setSearch={setSearch}
        renameId={renameId}
        renameValue={renameValue}
        onOpenCreateModal={openCreateModal}
        onSelectSession={handleSelectSession}
        onTogglePin={handleTogglePin}
        onEditSession={openEditModal}
        onCopySession={handleCopySession}
        onDeleteSession={handleDeleteSession}
        onRenameChange={setRenameValue}
        onRenameSubmit={handleRename}
        onRenameCancel={() => setRenameId("")}
        listRef={listRef}
      />

      {/* Main Area */}
      <section className="flex flex-1 min-w-0 flex-col">
        {/* Modular Header */}
        <ChatHeader
          activeSession={activeSession}
          activeSessionCodebase={activeSessionCodebase}
          viewMode={viewMode}
          setViewMode={setViewMode}
          paramsOpen={paramsOpen}
          setParamsOpen={setParamsOpen}
          showReasoning={showReasoning}
          setShowReasoning={setShowReasoning}
          skillsModalOpen={skillsModalOpen}
          setSkillsModalOpen={setSkillsModalOpen}
          shortcodesModalOpen={shortcodesModalOpen}
          setShortcodesModalOpen={setShortcodesModalOpen}
          terminalOpen={terminalOpen}
          toggleTerminal={toggleTerminal}
          projectOpen={projectOpen}
          projectTab={projectTab}
          toggleProject={toggleProject}
          onOpenModelModal={() => setModelModalOpen(true)}
          onOpenCodebaseEdit={() => {
            setCodebaseValue(activeSessionCodebase || "");
            setCodebaseEdit(true);
          }}
          onOpenMcpModal={() => {
            loadMcpServers();
            setMcpModalOpen(true);
          }}
          onDuplicateSession={() => activeSession && handleCopySession(activeSession)}
          onExport={handleExport}
          onOpenCreateModal={openCreateModal}
        />

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

        {appNotice ? (
          <div
            className={`mx-4 mt-3 rounded-xl border px-3 py-2 text-sm flex items-start gap-2.5 shadow-sm transition-all ${
              appNotice.type === "info"
                ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200"
                : appNotice.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : appNotice.type === "warning"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${
                appNotice.type === "info"
                  ? "text-sky-600 dark:text-sky-400"
                  : appNotice.type === "success"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : appNotice.type === "warning"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {appNotice.type === "info"
                ? "schedule"
                : appNotice.type === "success"
                ? "check_circle"
                : appNotice.type === "warning"
                ? "warning"
                : "error"}
            </span>
            <div className="flex-1 font-medium text-xs sm:text-sm leading-relaxed">{appNotice.text}</div>
            <button
              type="button"
              className="text-xs opacity-70 hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer"
              onClick={() => setAppNotice(null)}
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        ) : null}

        {/* Modular Message List */}
        <MessageList
          messages={messages}
          visibleMessages={visibleMessages}
          activeSessionModel={activeSession?.model}
          isSending={isSending}
          viewMode={viewMode}
          showReasoning={showReasoning}
          transcriptScrollRef={transcriptScrollRef}
          onTranscriptScroll={handleTranscriptScroll}
          bottomRef={bottomRef}
          showScrollBottomBtn={showScrollBottomBtn}
          onJumpToBottom={handleJumpToBottom}
          onSetDraft={setDraft}
          onCopy={handleCopy}
          onEditMessage={handleEditMessage}
          onRegenerate={handleRegenerate}
          onImageClick={handleImageClick}
          isLoading={isSessionLoading}
        />

        {/* Docked Terminal Panel */}
        <DockedTerminalPanel
          isOpen={terminalOpen}
          onClose={() => setTerminalOpen(false)}
          workspacePath={activeSessionCodebase}
          onSendToChat={(msg) => {
            setDraft(msg);
            sendMessage({ userText: msg });
          }}
        />

        {/* Composer & Overlay Area */}
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
                      onClick={() => handleImageClick(a.dataUrl, a.name || "Image")}
                      className="shrink-0 cursor-pointer"
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
                    className="material-symbols-outlined text-[14px] text-text-muted transition hover:text-red-500 cursor-pointer"
                  >
                    close
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {agentRole === "team" || teamTasks.length > 0 || (teamRoster.length > 0 && teamRoster.some((r) => r.name !== "orchestrator" && r.status !== "idle")) ? (
            <TeamPanel
              roster={teamRoster.length > 0 ? teamRoster : [
                { name: "orchestrator", role: "Team Lead", status: isSending ? "running" : "idle" },
                { name: "dev", role: "Developer", status: "idle" },
                { name: "qa", role: "QA Engineer", status: "idle" },
                { name: "reviewer", role: "Code Reviewer", status: "idle" },
              ]}
              tasks={teamTasks.length > 0 ? teamTasks : tasks.map((t, idx) => ({
                id: `task_${idx + 1}`,
                title: t.content,
                status: t.status === "in_progress" ? "in_progress" : t.status === "completed" ? "completed" : "pending",
                assignee: "orchestrator",
                dependsOn: idx > 0 ? [`task_${idx}`] : [],
              }))}
              messages={teamMessages}
              subAgents={subAgents.filter((s) => !s.sessionId || s.sessionId === activeSessionId)}
              onViewAgent={setViewingAgent}
            />
          ) : (tasks.length > 0 || subAgents.filter((s) => !s.sessionId || s.sessionId === activeSessionId).length > 0) ? (
            <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-border bg-sidebar/35 px-3 py-2 space-y-1.5">
              {tasks.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-medium text-text-muted">Tasks {tasks.filter((item) => item.status === "completed").length}/{tasks.length}:</span>
                  {tasks.map((item, index) => <span key={index} className={`rounded-full px-2 py-0.5 ${item.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : item.status === "in_progress" ? "bg-primary/10 text-primary" : "bg-background text-text-muted"}`}>{item.content}</span>)}
                </div>
              ) : null}
              {subAgents.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-text-muted">Agents:</span>
                  {subAgents.map((agent) => <button key={agent.id} type="button" title={agent.task} onClick={() => setViewingAgent(agent)} className="rounded-full border border-border bg-background px-2 py-0.5 hover:bg-sidebar transition cursor-pointer"><span className={agent.status === "running" ? "text-primary" : agent.status === "failed" ? "text-red-500" : "text-emerald-500"}>●</span> {agent.role}</button>)}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Ask & Approval Overlay */}
          <AskApprovalOverlay
            approvals={activeSessionApprovals}
            asks={activeSessionAsks}
            onResolveGate={resolveGate}
          />

          {activeQueue.length > 0 && (
            <div className="mx-auto mb-2 max-w-3xl rounded-xl border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs backdrop-blur-sm">
              <div className="flex items-center justify-between font-medium text-primary">
                <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-medium">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  Queued Messages ({activeQueue.length})
                </span>
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-[11px] text-text-muted hover:text-red-400 transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>
              <div className="mt-1.5 flex flex-col gap-1 max-h-28 overflow-y-auto custom-scrollbar">
                {activeQueue.map((item, qIdx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-surface/90 px-2.5 py-1.5 border border-sky-500/15 text-[11px]"
                  >
                    <span className="truncate flex-1 text-text-main font-mono">
                      <span className="text-sky-500 mr-1.5 font-semibold">#{qIdx + 1}</span>
                      {item.text || "(attachments only)"}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => runQueuedItemImmediately(item)}
                        className="flex items-center gap-1 rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-300 hover:bg-sky-500/25 transition-colors cursor-pointer"
                        title="Send this message now"
                      >
                        <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                        <span>Send now</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromQueue(item.id)}
                        className="text-text-muted hover:text-red-400 transition-colors p-0.5 rounded cursor-pointer"
                        title="Remove from queue"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Composer */}
          <div
            ref={composerRef}
            className="relative mx-auto max-w-3xl rounded-2xl border border-border bg-sidebar/40 p-2 shadow-sm"
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
            }}
            onDrop={handleComposerDrop}
          >
            <SlashCommandPalette
              matches={commandOptions}
              selected={commandIndex}
              onPick={(command) => {
                if (command.isShortcode) {
                  setDraft(`/shortcode ${command.tag} `);
                } else {
                  setDraft(`/${command.name}${command.args ? " " : ""}`);
                }
              }}
            />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handleComposerPaste}
              rows={1}
              disabled={isSessionLoading}
              placeholder={
                isSessionLoading
                  ? "Loading chat…"
                  : activeSession?.model
                  ? "Message… (paste or drop images/files)"
                  : "Select a model first"
              }
              className="w-full resize-none bg-transparent px-2 py-2 text-sm outline-none max-h-[25vh] custom-scrollbar disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 text-text-muted hover:bg-sidebar hover:text-text-main transition cursor-pointer"
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
                  className="hidden rounded-lg p-2 text-text-muted hover:bg-sidebar hover:text-text-main sm:block transition cursor-pointer"
                  title="Attach or drop files"
                >
                  <span className="material-symbols-outlined text-[20px]">attach_file</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoApprove;
                    setAutoApprove(next);
                    if (next) {
                      let rid = getChatRun(activeSessionId)?.runId;
                      if (!rid) { for (const [id, ctx] of liveRunRef.current.entries()) { if (ctx.isActive?.()) { rid = id; break; } } }
                      if (rid) fetch(`/api/chat/runs/${rid}/gates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoApprove: true }) }).catch(() => {});
                    }
                  }}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex transition cursor-pointer ${autoApprove ? "bg-emerald-500/10 text-emerald-600" : "text-text-muted hover:bg-sidebar"}`}
                  title="Auto-approve all tools for this run"
                >
                  <span className="material-symbols-outlined text-[15px]">{autoApprove ? "task_alt" : "shield"}</span>
                  {autoApprove ? "Auto" : "Approve"}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRoleMenuOpen((value) => !value)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-text-muted hover:bg-sidebar hover:text-text-main transition cursor-pointer"
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
                            updateAgentRole(role.id);
                            setRoleMenuOpen(false);
                          }}
                          className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${agentRole === role.id ? "border-primary/35 bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
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
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition cursor-pointer ${accessMode === "full" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-text-muted hover:bg-sidebar"}`}
                  title={accessMode === "full" ? "Full: bash and file writes enabled" : "Sandbox: read-only host tools"}
                >
                  <span className="material-symbols-outlined text-[15px]">{accessMode === "full" ? "admin_panel_settings" : "shield"}</span>
                  {accessMode === "full" ? "Full" : "Sandbox"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReasoning((value) => !value)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition cursor-pointer ${showReasoning ? "text-primary" : "text-text-muted hover:bg-sidebar"}`}
                  title="Show or hide reasoning"
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span>
                  Reasoning
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEffortMenuOpen((value) => !value)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex transition cursor-pointer ${reasoningEffort ? "text-primary" : "text-text-muted hover:bg-sidebar"}`}
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
                          className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${reasoningEffort === option.value ? "border-primary/35 bg-surface-2" : "border-transparent hover:bg-surface-2"}`}
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
                <Button size="sm" icon={isSending ? "queue" : "send"} onClick={() => draft.trim().startsWith("/") ? runCommand(draft) : sendMessage()} disabled={isSessionLoading || (!draft.trim().startsWith("/") && !canSend)}>
                  {isSending ? "Queue" : "Send"}
                </Button>
              </div>
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-text-muted">
            Enter send · Shift+Enter newline · ↑/↓ history · Esc stop · Ctrl+` terminal · / for commands · {AGENT_ROLES.find((role) => role.id === agentRole)?.label} · {accessMode} access
          </p>
        </div>
      </section>

      {projectOpen && activeSessionCodebase ? (
        <div className="hidden xl:block w-80 shrink-0 min-w-0">
          <ProjectSidebar
            workspacePath={activeSessionCodebase}
            sessionId={activeSessionId}
            refreshKey={projectRefresh}
            messages={messages}
            initialTab={projectTab}
            activeModel={activeSession?.model}
            onRun={(cmd) => { setDraft(`Run: ${cmd}`); }}
            onCompact={async () => {
              if (activeSessionId) {
                await loadSessionDetail(activeSessionId);
                await loadSessions(activeSessionId);
              }
            }}
            onClose={() => {
              setProjectOpen(false);
              try { globalThis.localStorage?.setItem("chat.projectOpen", "false"); } catch {}
            }}
          />
        </div>
      ) : null}

      <SkillsModal
        isOpen={skillsModalOpen}
        onClose={() => setSkillsModalOpen(false)}
        onInsertPrompt={(p) => setDraft((d) => d ? `${d}\n\n${p}` : p)}
      />

      <ShortcodesModal
        isOpen={shortcodesModalOpen}
        onClose={() => {
          setShortcodesModalOpen(false);
          loadShortcodes();
        }}
        onSelectShortcode={(sc) => {
          setDraft(`/shortcode ${sc.tag}`);
          loadShortcodes();
        }}
      />

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
              <button onClick={() => setMcpModalOpen(false)} className="text-text-muted hover:text-text-main transition cursor-pointer">
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
                  className={`px-3 py-1.5 transition ${mcpForm.transport === "sse" ? "bg-primary/15 text-primary font-medium" : "text-text-muted hover:bg-sidebar"}`}
                >
                  SSE / HTTP
                </button>
                <button
                  type="button"
                  onClick={() => setMcpForm((f) => ({ ...f, transport: "stdio" }))}
                  className={`px-3 py-1.5 border-l border-border transition ${mcpForm.transport === "stdio" ? "bg-primary/15 text-primary font-medium" : "text-text-muted hover:bg-sidebar"}`}
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

            <div className="max-h-56 space-y-1 overflow-y-auto custom-scrollbar">
              {mcpServers.length === 0 ? (
                <p className="py-3 text-center text-xs text-text-muted">No MCP servers yet.</p>
              ) : (
                mcpServers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
                    <button
                      onClick={() => toggleMcpServer(s)}
                      className={`size-3.5 rounded-full transition ${s.enabled ? "bg-emerald-500" : "bg-border"}`}
                      title={s.enabled ? "Enabled" : "Disabled"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{s.name}</p>
                      <p className="truncate text-[10px] text-text-muted font-mono">{s.transport === "sse" ? s.url : `${s.command} ${(s.args || []).join(" ")}`}</p>
                    </div>
                    <button onClick={() => removeMcpServer(s.id)} className="text-text-muted hover:text-red-500 transition cursor-pointer" title="Delete MCP server">
                      <span className="material-symbols-outlined text-[16px]">delete</span>
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
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sessionFormUrl}
                onChange={(e) => setSessionFormUrl(e.target.value)}
                placeholder="https://github.com/org/repo  or  F:\\project\\my-app"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveSessionModal();
                  if (e.key === "Escape") setSessionModalOpen(false);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setFolderPickerTarget("sessionModal");
                  setFolderPickerOpen(true);
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-sidebar px-2.5 py-2 text-xs font-medium text-text-main hover:bg-surface-2 hover:border-primary/50 transition shadow-sm cursor-pointer"
                title="Open file manager / browse local project folder"
              >
                <span className="material-symbols-outlined text-[17px] text-primary">folder_open</span>
                <span className="whitespace-nowrap">Open project</span>
              </button>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSessionModalOpen(false)}>Cancel</Button>
              {sessionModalMode === "edit" ? (
                <Button
                  size="sm"
                  variant="outline"
                  icon="content_copy"
                  onClick={() => {
                    setSessionModalOpen(false);
                    const target = sessions.find((s) => s.id === sessionFormEditId) || activeSession;
                    if (target) handleCopySession(target);
                  }}
                  title="Duplicate session (new session with same name and path)"
                >
                  Duplicate
                </Button>
              ) : null}
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
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={codebaseValue}
                onChange={(e) => setCodebaseValue(e.target.value)}
                placeholder="https://github.com/org/repo or git@host:org/repo.git"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveCodebase();
                  if (e.key === "Escape") setCodebaseEdit(false);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setFolderPickerTarget("codebaseModal");
                  setFolderPickerOpen(true);
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-sidebar px-2.5 py-2 text-xs font-medium text-text-main hover:bg-surface-2 hover:border-primary/50 transition shadow-sm cursor-pointer"
                title="Open file manager / browse local project folder"
              >
                <span className="material-symbols-outlined text-[17px] text-primary">folder_open</span>
                <span className="whitespace-nowrap">Open project</span>
              </button>
            </div>
            <p className="mt-2 text-[11px] text-text-muted">Leave empty to clear. Applies to this session only.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCodebaseEdit(false)}>Cancel</Button>
              <Button size="sm" onClick={saveCodebase}>Save</Button>
            </div>
          </div>
        </div>
      ) : null}

      <FolderPickerModal
        isOpen={folderPickerOpen}
        initialPath={
          folderPickerTarget === "sessionModal"
            ? sessionFormUrl
            : codebaseValue
        }
        onSelect={(pickedPath) => {
          if (folderPickerTarget === "sessionModal") {
            setSessionFormUrl(pickedPath);
            if (!sessionFormName.trim()) {
              const baseName = pickedPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
              if (baseName) setSessionFormName(baseName);
            }
          } else {
            setCodebaseValue(pickedPath);
          }
        }}
        onClose={() => setFolderPickerOpen(false)}
      />

      {viewingAgent ? (
        <SubAgentOverlay agent={viewingAgent} onClose={() => setViewingAgent(null)} />
      ) : null}

      <ConfirmModal
        isOpen={Boolean(deleteConfirmSession)}
        onClose={() => {
          if (!isDeletingSession) setDeleteConfirmSession(null);
        }}
        onConfirm={executeDeleteSession}
        title="Delete Session"
        message={
          deleteConfirmSession?.title
            ? `Delete session "${deleteConfirmSession.title}"? All messages in this session will be permanently removed.`
            : "Delete this session? All messages will be permanently removed."
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={isDeletingSession}
      />

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
                  className="rounded-lg p-1.5 text-text-muted hover:bg-sidebar hover:text-primary transition"
                  title="Download"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="material-symbols-outlined text-[20px]">download</span>
                </a>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-text-muted hover:bg-sidebar hover:text-text-main transition cursor-pointer"
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
              className="max-h-[75vh] w-full rounded-xl object-contain bg-black/10 [image-rendering:pixelated]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
