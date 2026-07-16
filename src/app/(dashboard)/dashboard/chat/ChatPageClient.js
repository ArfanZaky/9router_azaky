"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, ModelSelectModal } from "@/shared/components";

const SYSTEM_PRESETS = [
  { id: "none", label: "None", value: "" },
  { id: "coding", label: "Coding", value: "You are an expert software engineer. Be concise, correct, and prefer working code." },
  { id: "translate", label: "Translate", value: "You are a professional translator. Preserve meaning and tone. Default to clear natural language." },
  { id: "summarize", label: "Summarize", value: "Summarize clearly with key points and short bullets when useful." },
  { id: "custom", label: "Custom", value: null },
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
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
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
  const [agentMode, setAgentMode] = useState(true);
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

  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const composerRef = useRef(null);

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
    if (viewMode === "raw") return messages;
    return messages.filter((m) => m.role !== "tool");
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
        if (!cancelled && list[0]?.id) await loadSessionDetail(list[0].id);
      } catch (e) {
        if (!cancelled) setError(textValue(e.message) || "Failed to init chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeSessionId) return;
    loadSessionDetail(activeSessionId).catch((e) => setError(textValue(e.message)));
  }, [activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleSystemPreset = async (presetId) => {
    if (!activeSessionId) return;
    const preset = SYSTEM_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    if (preset.value === null) {
      setParamsOpen(true);
      return;
    }
    try {
      await patchSession(activeSessionId, { systemPrompt: preset.value });
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
    await fetch(`/api/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: nextMessages }),
    });
  };

  const handleStop = () => abortRef.current?.abort();

  const sendMessage = async ({ regenerate = false } = {}) => {
    if (!activeSession?.model) {
      setError("Select a model first.");
      return;
    }
    if (!apiKey) {
      setError("No API key. Create one in Endpoint & Key.");
      return;
    }

    let workingMessages = [...messages];
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

    const titleSeed =
      workingMessages.find((m) => m.role === "user")?.content || activeSession.title;

    const requestMessages = [];
    if (!agentMode && activeSession.systemPrompt?.trim()) {
      requestMessages.push({ role: "system", content: activeSession.systemPrompt.trim() });
    }
    for (const msg of workingMessages) {
      if (msg.id === assistantId) continue;
      if (msg.role === "tool") {
        requestMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id || msg.id,
          content: textValue(msg.content),
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
      requestMessages.push(entry);
    }

    let assistantText = "";
    let tokenUsage = null;
    let liveMessages = workingMessages;

    try {
      if (agentMode) {
        setAgentStatus("Agent starting…");
        const response = await fetch("/api/chat/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: activeSession.model,
            messages: requestMessages,
            systemPrompt: activeSession.systemPrompt || "",
            apiKey,
            accessMode,
            params: {
              temperature: params.temperature,
              max_tokens: params.max_tokens,
              top_p: params.top_p,
            },
            maxSteps: 12,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            textValue(errorData.error?.message || errorData.error || errorData.message) ||
              `Agent failed (${response.status})`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No agent stream");

        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";

        const upsertAssistant = (patch) => {
          liveMessages = liveMessages.map((m) =>
            m.id === assistantId ? { ...m, ...patch } : m
          );
          setMessages(liveMessages);
        };

        const appendMsg = (msg) => {
          liveMessages = [...liveMessages, msg];
          setMessages(liveMessages);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim() || "message";
              continue;
            }
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let data;
            try {
              data = JSON.parse(payload);
            } catch {
              continue;
            }

            if (eventName === "status") {
              setAgentStatus(
                data.phase === "thinking"
                  ? `Thinking (step ${data.step || "?"})…`
                  : data.phase === "init"
                    ? `Workspace: ${data.workspace || "…"}`
                    : data.phase || "…"
              );
            } else if (eventName === "text") {
              assistantText = data.content || assistantText;
              upsertAssistant({ content: assistantText, status: "streaming" });
            } else if (eventName === "message" && data.role === "assistant") {
              assistantText = data.content || assistantText;
              upsertAssistant({
                content: assistantText,
                tool_calls: data.tool_calls || null,
                status: data.tool_calls?.length ? "tool_calls" : "streaming",
              });
            } else if (eventName === "tool_start") {
              setAgentStatus(`Tool: ${data.name}…`);
              appendMsg({
                id: data.id || createId(),
                role: "tool",
                tool_call_id: data.id,
                name: data.name,
                content: JSON.stringify({ status: "running", arguments: data.arguments }, null, 0),
                status: "running",
                createdAt: new Date().toISOString(),
              });
            } else if (eventName === "tool_result") {
              setAgentStatus(`Tool done: ${data.name}`);
              const existingIdx = liveMessages.findIndex(
                (m) => m.role === "tool" && m.tool_call_id === data.id && m.status === "running"
              );
              const toolMsg = {
                id: data.id || createId(),
                role: "tool",
                tool_call_id: data.id,
                name: data.name,
                content: data.content,
                status: "done",
                createdAt: new Date().toISOString(),
              };
              if (existingIdx >= 0) {
                liveMessages = liveMessages.map((m, i) => (i === existingIdx ? toolMsg : m));
                setMessages(liveMessages);
              } else {
                appendMsg(toolMsg);
              }
            } else if (eventName === "error") {
              throw new Error(data.message || "Agent error");
            } else if (eventName === "done") {
              assistantText = data.finalText || assistantText;
              upsertAssistant({ content: assistantText || "(done)", status: "done" });
              setAgentStatus("");
            }
            eventName = "message";
          }
        }

        const finalMessages = liveMessages.map((m) =>
          m.id === assistantId
            ? { ...m, content: assistantText || m.content, status: "done" }
            : m.status === "running"
              ? { ...m, status: "done" }
              : m
        );
        setMessages(finalMessages);
        setAgentStatus("");

        const title =
          activeSession.title === "New chat" ? makeSessionTitle(titleSeed) : activeSession.title;
        await patchSession(activeSessionId, {
          title,
          model: activeSession.model,
          providerId: activeSession.providerId,
        });
        await persistMessages(activeSessionId, finalMessages);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s
          )
        );
      } else {
        const body = {
          model: activeSession.model,
          messages: requestMessages.filter((m) => m.role !== "tool"),
          stream: true,
          temperature: params.temperature,
          max_tokens: params.max_tokens,
          top_p: params.top_p,
        };

        const response = await fetch("/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            textValue(errorData.error?.message || errorData.error || errorData.message) ||
              `Request failed (${response.status})`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const data = await response.json().catch(() => ({}));
          assistantText = textValue(data?.choices?.[0]?.message?.content || "");
          tokenUsage = data?.usage || null;
        } else {
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const chunk = JSON.parse(payload);
                if (chunk.usage) tokenUsage = chunk.usage;
                const text = readAssistantText(chunk);
                if (!text) continue;
                assistantText += text;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: assistantText, status: "streaming" }
                      : m
                  )
                );
              } catch {
                // ignore malformed chunk
              }
            }
          }
        }

        const finalMessages = workingMessages.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: assistantText || m.content,
                status: "done",
                tokenUsage,
              }
            : m
        );
        setMessages(finalMessages);

        const title =
          activeSession.title === "New chat" ? makeSessionTitle(titleSeed) : activeSession.title;
        await patchSession(activeSessionId, {
          title,
          model: activeSession.model,
          providerId: activeSession.providerId,
        });
        await persistMessages(activeSessionId, finalMessages);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSessionId
              ? { ...s, title, updatedAt: new Date().toISOString() }
              : s
          )
        );
      }
    } catch (e) {
      if (e.name === "AbortError") {
        const finalMessages = liveMessages.map((m) =>
          m.id === assistantId
            ? { ...m, content: assistantText || m.content || "(stopped)", status: "done" }
            : m.status === "running"
              ? { ...m, status: "done", content: m.content || "(stopped)" }
              : m
        );
        setMessages(finalMessages);
        await persistMessages(activeSessionId, finalMessages).catch(() => {});
      } else {
        const errText = textValue(e.message) || "Failed to send";
        setError(errText);
        const finalMessages = liveMessages.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content || `Error: ${errText}`, status: "error", error: errText }
            : m
        );
        setMessages(finalMessages);
        await persistMessages(activeSessionId, finalMessages).catch(() => {});
      }
    } finally {
      setIsSending(false);
      setAgentStatus("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
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

          <div className="flex items-center gap-1.5 flex-wrap">
            {SYSTEM_PRESETS.filter((p) => p.id !== "custom").map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSystemPreset(p.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  (activeSession?.systemPrompt || "") === (p.value || "")
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:bg-sidebar"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setAgentMode((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-medium ${
                agentMode
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-text-muted hover:bg-sidebar"
              }`}
              title="Agent mode: host tools + skills"
            >
              {agentMode ? "Agent ON" : "Agent OFF"}
            </button>
            {agentMode ? (
              <div className="flex rounded-full border border-border overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setAccessMode("sandbox")}
                  className={`px-2.5 py-1.5 ${
                    accessMode === "sandbox"
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-text-muted hover:bg-sidebar"
                  }`}
                  title="Sandbox: read/list/grep + web + image (no bash/write)"
                >
                  Sandbox
                </button>
                <button
                  type="button"
                  onClick={() => setAccessMode("full")}
                  className={`px-2.5 py-1.5 border-l border-border ${
                    accessMode === "full"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium"
                      : "text-text-muted hover:bg-sidebar"
                  }`}
                  title="Full: bash + write_file + all sandbox tools"
                >
                  Full
                </button>
              </div>
            ) : null}
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

        {agentMode ? (
          <div className="shrink-0 border-b border-border bg-primary/5 px-4 py-1.5 text-[11px] text-text-muted flex flex-wrap items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-primary">
              {accessMode === "full" ? "admin_panel_settings" : "shield"}
            </span>
            <span>
              {accessMode === "full"
                ? "Full access: bash · write · read/list/grep · web · image"
                : "Sandbox: read/list/grep · web · image (no bash/write)"}
              {" · "}
              view: {viewMode === "raw" ? "raw tools" : "chat only"}
            </span>
            {agentStatus ? <span className="ml-auto text-primary">{agentStatus}</span> : null}
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
                  "Summarize the key risks of this design",
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
                      <div className="whitespace-pre-wrap break-words text-[14px] leading-6">
                        {content}
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
          <div
            ref={composerRef}
            className="mx-auto max-w-3xl rounded-2xl border border-border bg-sidebar/40 p-2"
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault();
            }}
            onDrop={handleComposerDrop}
          >
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
              <div className="flex items-center gap-1">
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
                <span className="text-[10px] text-text-muted hidden sm:inline">
                  paste · drop · attach
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isSending ? (
                  <Button variant="ghost" size="sm" icon="stop" onClick={handleStop}>
                    Stop
                  </Button>
                ) : null}
                <Button size="sm" icon="send" onClick={() => sendMessage()} disabled={!canSend}>
                  Send
                </Button>
              </div>
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-text-muted">
            Enter send · Shift+Enter newline · Esc stop · paste images ·{" "}
            {agentMode ? `${accessMode} access · ${viewMode === "raw" ? "raw" : "chat"} view` : "plain chat"}
          </p>
        </div>
      </section>

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
