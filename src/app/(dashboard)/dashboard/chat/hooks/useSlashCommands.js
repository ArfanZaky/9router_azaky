"use client";

import { useCallback, useMemo, useState } from "react";
import { CHAT_COMMANDS, commandMatches } from "../SlashCommandPalette";

export function useSlashCommands({
  draft,
  setDraft,
  shortcodes,
  activeSession,
  activeSessionId,
  sessions,
  handleNewChat,
  handleCopySession,
  sessionAction,
  patchSession,
  setModelModalOpen,
  updateAgentRole,
  handleStop,
  handleExport,
  sendMessage,
  approvals,
  resolveGate,
  setProjectInfo,
  setProjectOpen,
  setPendingProject,
  openEditModal,
  setSkillsModalOpen,
  setShortcodesModalOpen,
  loadMcpServers,
  setMcpModalOpen,
  verifyMode,
  setVerifyMode,
  loadSessionDetail,
  toggleTerminal,
  setAgentStatus,
  setError,
  setNotice,
}) {
  const [commandIndex, setCommandIndex] = useState(0);

  const commandOptions = useMemo(
    () => commandMatches(draft, shortcodes),
    [draft, shortcodes]
  );

  const runCommand = useCallback(
    async (line) => {
      const [rawName, ...parts] = line.trim().slice(1).split(/\s+/);
      const name = rawName.toLowerCase();
      const value = parts.join(" ");
      setDraft("");
      try {
        if (name === "help") {
          const list = CHAT_COMMANDS.map((command) => `/${command.name}${command.args ? ` ${command.args}` : ""} — ${command.summary}`).join("\n");
          return { type: "system", content: list };
        }
        if (name === "new") {
          await handleNewChat();
          return null;
        }
        if (name === "copy" || name === "duplicate") {
          const current = sessions.find((s) => s.id === activeSessionId) || activeSession;
          if (!current) throw new Error("No active session to copy");
          await handleCopySession(current);
          return null;
        }
        if (name === "terminal") {
          toggleTerminal();
          return null;
        }
        if (name === "clear") {
          await sessionAction("clear");
          return null;
        }
        if (name === "undo") {
          await sessionAction("undo");
          return null;
        }
        if (name === "fork") {
          await sessionAction("fork", { title: value });
          return null;
        }
        if (name === "rename") {
          if (!value) throw new Error("Usage: /rename <title>");
          await patchSession(activeSessionId, { title: value });
          return null;
        }
        if (name === "model") {
          setModelModalOpen(true);
          return null;
        }
        if (name === "agent") {
          updateAgentRole(value.toLowerCase());
          return null;
        }
        if (name === "agent-teams") {
          updateAgentRole("team");
          if (value) {
            await sendMessage({ userText: value });
          }
          return null;
        }
        if (name === "retry") {
          sendMessage({ regenerate: true });
          return null;
        }
        if (name === "stop") {
          handleStop();
          return null;
        }
        if (name === "export") {
          handleExport(value === "json" ? "json" : "md");
          return null;
        }
        if (name === "steer") {
          if (!value) throw new Error("Usage during an active run: /steer <instruction>");
          const res = await fetch(`/api/chat/runs/${activeSessionId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instruction: value }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Unable to steer run");
          setAgentStatus?.("Steering queued");
          return null;
        }
        if (name === "approve") {
          const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
          if (curApprovals.length === 0) throw new Error("No pending approval");
          await resolveGate(curApprovals[0], "allow");
          setNotice?.("Approval granted", "success");
          return null;
        }
        if (name === "deny") {
          const curApprovals = approvals.filter((a) => a.sessionId === activeSessionId);
          if (curApprovals.length === 0) throw new Error("No pending approval");
          await resolveGate(curApprovals[0], "deny");
          setNotice?.("Approval denied", "info");
          return null;
        }
        if (name === "project") {
          if (!value) throw new Error("Usage: /project <absolute path>");
          const inspect = await fetch("/api/chat/projects/inspect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: value }),
          });
          const data = await inspect.json().catch(() => ({}));
          if (!inspect.ok) throw new Error(data.error || "Unable to inspect project");
          await patchSession(activeSessionId, {
            workspacePath: data.workspacePath,
            codebase: data.workspacePath,
            projectMeta: { name: data.name, packageName: data.packageName },
          });
          setProjectInfo(data);
          setProjectOpen(true);
          try { globalThis.localStorage?.setItem("chat.projectOpen", "true"); } catch {}
          setPendingProject({ path: data.workspacePath, name: data.name });
          return null;
        }
        if (name === "codebase") {
          const current = sessions.find((s) => s.id === activeSessionId);
          if (current) openEditModal(current);
          return null;
        }
        if (name === "skills" || name === "skill") {
          setSkillsModalOpen(true);
          return null;
        }
        if (name === "shortcode" || name === "shortcodes") {
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
          return null;
        }
        if (name === "mcp") {
          await loadMcpServers();
          setMcpModalOpen(true);
          return null;
        }
        if (name === "verify") {
          setVerifyMode((v) => !v);
          setNotice(verifyMode ? "Verification disabled for next run" : "Verification enabled for next run", "info");
          return null;
        }
        if (name === "compact") {
          const res = await fetch(`/api/chat/sessions/${activeSessionId}/compact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ keepLastN: 20 }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Failed to compact session");
          await loadSessionDetail(activeSessionId);
          setNotice(`Session compacted: kept ${data.keepLastN} recent messages`, "success");
          return null;
        }
        throw new Error(`Unknown command: /${name}`);
      } catch (e) {
        setError(e.message || String(e));
        return null;
      }
    },
    [
      setDraft,
      handleNewChat,
      sessions,
      activeSessionId,
      activeSession,
      handleCopySession,
      toggleTerminal,
      sessionAction,
      patchSession,
      setModelModalOpen,
      updateAgentRole,
      sendMessage,
      handleStop,
      handleExport,
      approvals,
      resolveGate,
      setNotice,
      setProjectInfo,
      setProjectOpen,
      setPendingProject,
      openEditModal,
      setSkillsModalOpen,
      setShortcodesModalOpen,
      shortcodes,
      loadMcpServers,
      setMcpModalOpen,
      setVerifyMode,
      verifyMode,
      loadSessionDetail,
      setAgentStatus,
      setError,
    ]
  );

  return {
    commandIndex,
    setCommandIndex,
    commandOptions,
    runCommand,
  };
}
