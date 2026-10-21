"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getActiveRunSessions,
  getChatRun,
  isRunActiveFor,
  startChatRun,
  patchChatRun,
  clearChatRun,
  abortChatRun,
} from "@/lib/chat/chatRunRuntime";

export function useRunExecution({
  activeSessionId,
  agentRole,
  onRunComplete = () => {},
  setError = () => {},
  setNotice = () => {},
}) {
  const [runningSessionIds, setRunningSessionIds] = useState(() => new Set(getActiveRunSessions()));
  const runningSessionIdsRef = useRef(new Set(getActiveRunSessions()));
  useEffect(() => {
    runningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds]);

  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  useEffect(() => {
    isSendingRef.current = isSending;
  }, [isSending]);

  const [agentStatus, setAgentStatus] = useState("");
  const [liveInfo, setLiveInfo] = useState({ turn: 0, tool: null, waiting: false, notice: "", elapsed: 0 });

  const isCurrentSessionActive = isRunActiveFor(activeSessionId) || isSending;

  const handleStopRun = useCallback((sessionId) => {
    const target = sessionId || activeSessionId;
    if (!target) return;
    abortChatRun(target);
    clearChatRun(target);
    if (target === activeSessionId) {
      isSendingRef.current = false;
      setIsSending(false);
      setAgentStatus("");
    }
    setRunningSessionIds((prev) => {
      const next = new Set(prev);
      next.delete(target);
      return next;
    });
  }, [activeSessionId]);

  return {
    runningSessionIds,
    setRunningSessionIds,
    runningSessionIdsRef,
    isSending,
    setIsSending,
    isSendingRef,
    agentStatus,
    setAgentStatus,
    liveInfo,
    setLiveInfo,
    isCurrentSessionActive,
    handleStopRun,
  };
}
