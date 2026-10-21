"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getCachedTranscript,
  setCachedTranscript,
  deleteCachedTranscript,
} from "@/lib/chat/chatCacheIndexedDb";

const DEFAULT_PARAMS = {
  temperature: 0.7,
  max_tokens: 4096,
  top_p: 1,
};

export function useChatSessions({
  urlSessionId = "",
  urlWorkspace = "",
  onSelectCallback = null,
  setError = () => {},
  setNotice = () => {},
}) {
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

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [renameId, setRenameId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const activeSessionCodebase = useMemo(
    () => activeSession?.workspacePath || activeSession?.codebase || "",
    [activeSession?.workspacePath, activeSession?.codebase]
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

  const patchSession = useCallback(async (id, patch) => {
    const res = await fetch(`/api/chat/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to update session");
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    return data;
  }, []);

  const handleTogglePin = useCallback(async (session) => {
    try {
      await patchSession(session.id, { pinned: !session.pinned });
    } catch (e) {
      setError(e.message);
    }
  }, [patchSession, setError]);

  const handleRename = useCallback(async (id) => {
    const title = renameValue.trim();
    if (!title) return;
    try {
      await patchSession(id, { title });
      setRenameId("");
      setRenameValue("");
    } catch (e) {
      setError(e.message);
    }
  }, [renameValue, patchSession, setError]);

  return {
    sessions,
    setSessions,
    sessionsRef,
    activeSessionId,
    setActiveSessionId,
    activeSessionIdRef,
    activeSession,
    activeSessionCodebase,
    sortedSessions,
    search,
    setSearch,
    loading,
    setLoading,
    renameId,
    setRenameId,
    renameValue,
    setRenameValue,
    deleteConfirmSession,
    setDeleteConfirmSession,
    isDeletingSession,
    setIsDeletingSession,
    loadSessions,
    patchSession,
    handleTogglePin,
    handleRename,
    DEFAULT_PARAMS,
  };
}
