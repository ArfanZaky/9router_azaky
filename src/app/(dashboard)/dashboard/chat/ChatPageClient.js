"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, ModelSelectModal } from "@/shared/components";
import ChatMarkdown from "./ChatMarkdown";
import ChatToolCard from "./ChatToolCard";
import SlashCommandPalette, { CHAT_COMMANDS, commandMatches } from "./SlashCommandPalette";
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
  const [tasks, setTasks] = useState([]);
  const [subAgents, setSubAgents] = useState([]);
  const [projectOpen, setProjectOpen] = useState(true);
  const [projectInfo, setProjectInfo] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);

  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const activeSessionIdRef = useRef(activeSessionId);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);
  const websocketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const liveRunRef = useRef(null);

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
      globalThis.localStorage?.setItem("chat.viewMode", viewMode);
    } catch {
      // ignore
    }
  }, [viewMode]);

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
    const res = await fetch(`/api/chat/sessions/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load session");
    setMessages(data.messages || []);
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
      if (!liveRunRef.current || liveRunRef.current.runId !== existing.runId) {
        let lastSeq = 0;
        liveRunRef.current = {
          runId: existing.runId,
          lastSeq: () => lastSeq,
          isActive: () => !!getChatRun()?.isSending,
          applyEvent: (event) => {
            if (!event || event.seq <= lastSeq) return;
            lastSeq = event.seq;
            const data = event.data || {};
            if (event.type === "text" || (event.type === "message" && data.role === "assistant")) {
              const content = data.content || existing.assistantText || "";
              patchChatRun({
                assistantText: content,
                messages: (getChatRun()?.messages || []).map((m) =>
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
              patchChatRun({
                agentStatus:
                  data.phase === "thinking"
                    ? `Thinking (step ${data.step || "?"})…`
                    : data.phase || "Working…",
              });
            } else if (event.type === "reasoning") {
              const reasoning = data.content || "";
              patchChatRun({
                messages: (getChatRun()?.messages || []).map((m) => m.id === existing.assistantId
                  ? { ...m, reasoning, segments: [...(m.segments || []).filter((s) => s.type !== "reasoning"), { type: "reasoning", content: reasoning }] }
                  : m),
              });
            } else if (event.type === "task_update") {
              setTasks(data.items || []);
            } else if (event.type === "subagent_start") {
              setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), { ...data, status: "running" }]);
            } else if (event.type === "subagent_done") {
              setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data, status: data.error ? "failed" : "completed" } : item));
            } else if (event.type === "tool_start" || event.type === "tool_result") {
              // Reload session messages on tool boundaries after remount.
              loadSessionDetail(existing.sessionId).catch(() => {});
              patchChatRun({
                agentStatus:
                  event.type === "tool_start"
                    ? `Tool: ${data.name}…`
                    : `Tool done: ${data.name}`,
              });
            } else if (event.type === "done" || event.type === "error") {
              const finalMessages = data.messages || getChatRun()?.messages || [];
              patchChatRun({
                messages: finalMessages,
                assistantText: data.finalText || data.message || "",
                isSending: false,
                agentStatus: "",
                error: event.type === "error" ? data.message || "Chat failed" : "",
              });
              clearChatRun();
              liveRunRef.current = null;
              // eslint-disable-next-line react-hooks/immutability
              stopRunTransport();
              if (mountedRef.current && activeSessionIdRef.current === existing.sessionId) {
                setMessages(finalMessages);
                setIsSending(false);
                setAgentStatus("");
                if (event.type === "error") setError(data.message || "Chat failed");
              }
            }
          },
        };
      }
      // eslint-disable-next-line react-hooks/immutability
      connectRunSocket(existing.runId, 0);
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
        const [keysRes, providersRes, aliasesRes] = await Promise.all([
          fetch("/api/keys"),
          fetch("/api/providers"),
          fetch("/api/models/alias").catch(() => null),
        ]);
        const keysData = await keysRes.json().catch(() => ({}));
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = aliasesRes ? await aliasesRes.json().catch(() => ({})) : {};
        if (cancelled) return;
        setApiKey((keysData.keys || []).find((k) => k.isActive !== false)?.key || "");
        setActiveProviders(providersData.connections || []);
        setModelAliases(aliasesData.aliases || {});
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
    if (!activeSessionId) return;
    const run = getChatRun();
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
    scrollToBottom();
  }, [messages, isSending, scrollToBottom]);

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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create session");
      setSessions((prev) => [data, ...prev]);
      setActiveSessionId(data.id);
      setMessages([]);
      setDraft("");
      setAttachments([]);
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

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await addImageFiles(files);
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
    if (images.length === 0) return;
    event.preventDefault();
    await addImageFiles(images);
  };

  const persistMessages = async (sessionId, nextMessages) => {
    await persistChatMessages(sessionId, nextMessages);
  };

  const handleStop = () => {
    abortChatRun();
    abortRef.current?.abort();
  };

  const stopRunTransport = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (websocketRef.current) {
      try {
        websocketRef.current.onclose = null;
        websocketRef.current.onerror = null;
        websocketRef.current.close();
      } catch {
        // ignore
      }
      websocketRef.current = null;
    }
  };

  const connectRunSocket = (runId, after = 0) => {
    if (!runId || typeof WebSocket === "undefined") return;
    stopRunTransport();
    const protocol = globalThis.location?.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${globalThis.location.host}/api/chat/ws`);
    websocketRef.current = socket;
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
        for (const event of payload.run.events) liveRunRef.current?.applyEvent(event);
        return;
      }
      const event = payload.type === "event" ? payload.event : null;
      if (!event || !liveRunRef.current || liveRunRef.current.runId !== runId) return;
      liveRunRef.current.applyEvent(event);
    };
    socket.onclose = () => {
      if (liveRunRef.current?.runId === runId && liveRunRef.current.isActive()) {
        reconnectTimerRef.current = setTimeout(
          () => connectRunSocket(runId, liveRunRef.current?.lastSeq?.() || 0),
          1000
        );
      }
    };
  };

  const applyUiIfActive = (sessionId, fn) => {
    if (!mountedRef.current) return;
    if (activeSessionIdRef.current !== sessionId) return;
    fn();
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

    patchChatRun({
      messages: finalMessages,
      assistantText: summary,
      isSending: false,
      agentStatus: "",
      error: errorText || "",
    });
    clearChatRun();

    // session list always refresh; transcript only if viewing this session
    if (mountedRef.current) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s
        )
      );
    }
    applyUiIfActive(sessionId, () => {
      setMessages(finalMessages);
      setIsSending(false);
      setAgentStatus("");
      if (errorText) setError(errorText);
    });

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
    if (getChatRun()?.isSending) {
      setError("A chat is already running. Stop it first or wait.");
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
      const userMessage = {
        id: createId(),
        role: "user",
        content: userText,
        attachments: attachments.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          dataUrl: a.dataUrl,
        })),
        status: "done",
        createdAt: new Date().toISOString(),
      };
      workingMessages = [...workingMessages, userMessage];
      setDraft("");
      setAttachments([]);
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

    const pushLive = (next, statusText) => {
      liveMessages = next;
      patchChatRun({
        messages: next,
        assistantText,
        agentStatus: statusText ?? getChatRun()?.agentStatus ?? "",
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
      patchChatRun({
        messages: finalMessages,
        assistantText: finalText,
        isSending: false,
        agentStatus: "",
        error: isError ? data.message || "Chat failed" : "",
      });
      clearChatRun();
      liveRunRef.current = null;
      stopRunTransport();
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
          params: {
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            top_p: params.top_p,
          },
          maxSteps: 12,
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
      patchChatRun({ runId: started.id, agentStatus: `${AGENT_ROLES.find((role) => role.id === agentRole)?.label || "Agent"} running…` });
      let lastSeq = 0;
      liveRunRef.current = {
        runId: started.id,
        lastSeq: () => lastSeq,
        isActive: () => !!getChatRun()?.isSending,
        applyEvent: (event) => {
          if (!event || event.seq <= lastSeq) return;
          lastSeq = event.seq;
          const data = event.data || {};
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
            const st =
              data.phase === "thinking"
                ? `Thinking (step ${data.step || "?"})…`
                : data.phase === "init"
                  ? `Workspace: ${data.workspace || "…"}`
                  : data.phase || "Working…";
            pushLive(liveMessages, st);
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
          } else if (event.type === "task_update") {
            setTasks(data.items || []);
          } else if (event.type === "subagent_start") {
            setSubAgents((prev) => [...prev.filter((item) => item.id !== data.id), { ...data, status: "running" }]);
          } else if (event.type === "subagent_done") {
            setSubAgents((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data, status: data.error ? "failed" : "completed" } : item));
          } else if (event.type === "notice") {
            setAgentStatus(data.message || "Working…");
          } else if (event.type === "done") {
            finalizeServerEvent(data);
          } else if (event.type === "error") {
            finalizeServerEvent(data, true);
          }
        },
      };
      connectRunSocket(started.id, 0);
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
      liveRunRef.current = null;
      stopRunTransport();
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
    }
    if (event.key === "Escape" && isSending) handleStop();
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
        setError(CHAT_COMMANDS.map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.summary}`).join("\n"));
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
        const runId = getChatRun()?.runId;
        if (!runId || !value) throw new Error("Usage during an active run: /steer <instruction>");
        const res = await fetch(`/api/chat/runs/${runId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: value }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Unable to steer run");
        setAgentStatus("Steering queued");
      } else if (name === "project") {
        if (!value) throw new Error("Usage: /project <absolute path>");
        const inspect = await fetch("/api/chat/projects/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: value }) });
        const data = await inspect.json().catch(() => ({}));
        if (!inspect.ok) throw new Error(data.error || "Unable to inspect project");
        await patchSession(activeSessionId, { workspacePath: data.workspacePath, projectMeta: { name: data.name, packageName: data.packageName } });
        setProjectInfo(data);
        setProjectOpen(true);
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
          <Button className="w-full" icon="add" onClick={handleNewChat}>
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
                          setRenameId(session.id);
                          setRenameValue(session.title || "");
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
            <Button className="md:hidden" variant="ghost" size="sm" icon="add" onClick={handleNewChat}>
              New
            </Button>
          </div>
        </header>

        {agentStatus ? (
          <div className="shrink-0 border-b border-border bg-primary/5 px-4 py-1.5 text-[11px] text-primary">
            {agentStatus}
          </div>
        ) : null}

        {paramsOpen ? (
          <div className="shrink-0 border-b border-border bg-sidebar/30 px-4 py-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 lg:px-6">
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
              {visibleMessages.map((message) => {
                const isUser = message.role === "user";
                const isTool = message.role === "tool";
                const content = textValue(message.content);

                if (isTool) {
                  const preview =
                    content.length > 1200 ? `${content.slice(0, 1200)}\n…` : content;
                  return (
                    <div key={message.id} className="flex justify-start">
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
                  <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
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
                  ) : null}
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
                {subAgents.map((agent) => <span key={agent.id} title={agent.task} className="rounded-full border border-border px-2 py-0.5"><span className={agent.status === "running" ? "text-primary" : agent.status === "failed" ? "text-red-500" : "text-emerald-500"}>●</span> {agent.role}</span>)}
              </div>
            </div>
          ) : null}
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
                  ? "Message… (paste or drop images)"
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
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleAttachFiles}
                />
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
                    <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-border bg-background p-1 shadow-2xl">
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Agent role</p>
                      {AGENT_ROLES.map((role) => (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => {
                            setAgentRole(role.id);
                            setRoleMenuOpen(false);
                          }}
                          className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left ${agentRole === role.id ? "bg-primary/10" : "hover:bg-sidebar"}`}
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
                  className={`hidden items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex ${accessMode === "full" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "text-text-muted hover:bg-sidebar"}`}
                  title={accessMode === "full" ? "Full: bash and file writes enabled" : "Sandbox: read-only host tools"}
                >
                  <span className="material-symbols-outlined text-[15px]">{accessMode === "full" ? "admin_panel_settings" : "shield"}</span>
                  {accessMode === "full" ? "Full" : "Sandbox"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReasoning((value) => !value)}
                  className={`hidden items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] sm:flex ${showReasoning ? "text-primary" : "text-text-muted hover:bg-sidebar"}`}
                  title="Show or hide reasoning"
                >
                  <span className="material-symbols-outlined text-[15px]">psychology</span>
                  Reasoning
                </button>
              </div>
              <div className="flex items-center gap-2">
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
            Enter send · Shift+Enter newline · Esc stop · / for commands · {AGENT_ROLES.find((role) => role.id === agentRole)?.label} · {accessMode} access
          </p>
        </div>
      </section>

      {projectOpen && activeSession?.workspacePath ? (
        <aside className="hidden xl:flex w-80 shrink-0 flex-col border-l border-border bg-sidebar/25">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-primary">folder_open</span><p className="truncate text-sm font-semibold">{projectInfo?.name || activeSession.projectMeta?.name || "Project"}</p></div>
            <p className="mt-1 truncate font-mono text-[10px] text-text-muted" title={activeSession.workspacePath}>{activeSession.workspacePath}</p>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
            {Object.keys(projectInfo?.scripts || {}).length ? <div className="mb-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Scripts</p>{Object.entries(projectInfo.scripts).map(([name, command]) => <button key={name} type="button" onClick={() => setDraft(`Run npm script ${name}: ${command}`)} className="mb-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-left"><span className="font-mono text-[11px] text-primary">{name}</span><span className="ml-2 truncate font-mono text-[10px] text-text-muted">{command}</span></button>)}</div> : null}
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Files</p>
            <div className="space-y-0.5">{(projectInfo?.files || []).map((file) => <div key={file.path} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-sidebar"><span className="material-symbols-outlined text-[14px] text-text-muted">{file.type === "directory" ? "folder" : "description"}</span><span className="truncate font-mono">{file.path}</span></div>)}</div>
          </div>
        </aside>
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
