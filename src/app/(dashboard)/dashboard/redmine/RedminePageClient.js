"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

function getStatusBadgeClass(statusName = "") {
  const s = statusName.toLowerCase();
  if (s.includes("done") || s.includes("close") || s.includes("resolved")) {
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  }
  if (s.includes("progress") || s.includes("doing") || s.includes("dev")) {
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
  }
  if (s.includes("ready") || s.includes("start")) {
    return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
  }
  if (s.includes("qa") || s.includes("review") || s.includes("test")) {
    return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
  }
  if (s.includes("cancel") || s.includes("reject")) {
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
  }
  return "bg-surface-2 text-text-muted border-border";
}

function getPriorityBadgeClass(priorityName = "") {
  const p = priorityName.toLowerCase();
  if (p.includes("urgent") || p.includes("immediate") || p.includes("high")) {
    return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 font-semibold";
  }
  if (p.includes("low")) {
    return "bg-surface-2/60 text-text-subtle border-border-subtle";
  }
  return "bg-surface-2 text-text-muted border-border";
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getInitials(name = "") {
  const clean = name.trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isImageFile(filename = "", contentType = "") {
  if (contentType.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
}

function getAttachmentProxyUrl(attachment) {
  if (!attachment) return "";
  if (attachment.id) {
    const encUrl = attachment.content_url ? encodeURIComponent(attachment.content_url) : "";
    return `/api/redmine/attachment?id=${attachment.id}&url=${encUrl}`;
  }
  if (attachment.content_url) {
    return `/api/redmine/attachment?url=${encodeURIComponent(attachment.content_url)}`;
  }
  return "";
}

export default function RedminePageClient() {
  const router = useRouter();

  // Top level active tab: "tasks" | "projects"
  const [activeTab, setActiveTab] = useState("tasks");

  // Tasks state
  const [issues, setIssues] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Projects state
  const [projectsList, setProjectsList] = useState([]);
  const [knownWorkspaces, setKnownWorkspaces] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsRefreshing, setProjectsRefreshing] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectPathFilter, setProjectPathFilter] = useState("all"); // "all" | "assigned" | "unassigned"

  // Assign Path Modal
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTargetProject, setAssignTargetProject] = useState(null);
  const [assignPathInput, setAssignPathInput] = useState("");
  const [assigningPath, setAssigningPath] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");
  const [assignError, setAssignError] = useState("");

  const [meta, setMeta] = useState({
    projects: [],
    statuses: [],
    trackers: [],
    timeEntryActivities: [],
    config: null,
  });

  const [statusFilter, setStatusFilter] = useState("open");
  const [projectFilter, setProjectFilter] = useState("");
  const [trackerFilter, setTrackerFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Detail Modal & Chat View
  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [issueDetail, setIssueDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // Chat message & attachment state
  const [chatInputText, setChatInputText] = useState("");
  const [chatStatusChange, setChatStatusChange] = useState("");
  const [chatDoneRatioChange, setChatDoneRatioChange] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [sendingChat, setSendingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [activeImagePreview, setActiveImagePreview] = useState(null);

  // Quick Log Time Modal
  const [showLogTimeModal, setShowLogTimeModal] = useState(false);
  const [logTimeTargetIssue, setLogTimeTargetIssue] = useState(null);
  const [logHours, setLogHours] = useState("");
  const [logActivityId, setLogActivityId] = useState("");
  const [logSpentOn, setLogSpentOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [logComments, setLogComments] = useState("");
  const [savingLogTime, setSavingLogTime] = useState(false);
  const [logTimeMsg, setLogTimeMsg] = useState("");
  const [logTimeError, setLogTimeError] = useState("");

  // Config modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cfgBaseUrl, setCfgBaseUrl] = useState("https://redmine.profescipta.co.id");
  const [cfgApiKey, setCfgApiKey] = useState("");
  const [cfgEmail, setCfgEmail] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  const fileInputRef = useRef(null);
  const chatBottomRef = useRef(null);
  const chatContainerRef = useRef(null);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/redmine/meta");
      if (res.ok) {
        const data = await res.json();
        setMeta(data);
        if (data.config) {
          setCfgBaseUrl(data.config.baseUrl || "https://redmine.profescipta.co.id");
          setCfgEmail(data.config.userEmail || "");
        }
      }
    } catch {
      // quiet fail on background metadata load
    }
  }, []);

  const fetchIssues = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      const params = new URLSearchParams();
      if (statusFilter) params.append("status_id", statusFilter);
      if (projectFilter) params.append("project_id", projectFilter);
      if (trackerFilter) params.append("tracker_id", trackerFilter);
      if (searchQuery.trim()) params.append("q", searchQuery.trim());
      params.append("limit", "100");

      const res = await fetch(`/api/redmine/issues?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch issues from Redmine");
      }

      setIssues(data.issues || []);
      setTotalCount(data.totalCount ?? (data.issues?.length || 0));
    } catch (err) {
      setError(err.message || "An unexpected error occurred while loading tasks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, projectFilter, trackerFilter, searchQuery]);

  const fetchProjects = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setProjectsRefreshing(true);
      else setProjectsLoading(true);
      setProjectsError("");

      const res = await fetch("/api/redmine/projects");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch projects list from Redmine");
      }

      setProjectsList(data.projects || []);
      setKnownWorkspaces(data.knownWorkspaces || []);
    } catch (err) {
      setProjectsError(err.message || "Failed to load Redmine projects");
    } finally {
      setProjectsLoading(false);
      setProjectsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (activeTab === "tasks") {
      fetchIssues();
    } else if (activeTab === "projects") {
      fetchProjects();
    }
  }, [activeTab, fetchIssues, fetchProjects]);

  const openIssueDetail = useCallback(async (id, silent = false) => {
    setSelectedIssueId(id);
    if (!silent) {
      setDetailLoading(true);
      setDetailError("");
      setChatInputText("");
      setPendingAttachments([]);
      setChatError("");
    }

    try {
      const res = await fetch(`/api/redmine/issues/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load issue details");
      setIssueDetail(data);
      setChatStatusChange(String(data.status?.id || ""));
      setChatDoneRatioChange(data.done_ratio ?? 0);
    } catch (err) {
      setDetailError(err.message || "Failed to load issue details");
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  const closeIssueDetail = () => {
    pendingAttachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    });
    setPendingAttachments([]);
    setSelectedIssueId(null);
    setIssueDetail(null);
    setDetailError("");
    setChatError("");
    setChatInputText("");
  };

  useEffect(() => {
    if (issueDetail && chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [issueDetail?.journals?.length, issueDetail?.id]);

  const addFilesToPending = (files) => {
    if (!files || files.length === 0) return;
    const newItems = Array.from(files).map((f) => {
      const isImg = isImageFile(f.name, f.type);
      return {
        file: f,
        name: f.name || `clipboard-${Date.now()}.${isImg ? "png" : "bin"}`,
        size: f.size || 0,
        type: f.type || (isImg ? "image/png" : "application/octet-stream"),
        previewUrl: isImg ? URL.createObjectURL(f) : null,
      };
    });
    setPendingAttachments((prev) => [...prev, ...newItems]);
  };

  const removePendingAttachment = (index) => {
    setPendingAttachments((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleChatPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const filesToUpload = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) filesToUpload.push(file);
      }
    }
    if (filesToUpload.length > 0) {
      e.preventDefault();
      addFilesToPending(filesToUpload);
    }
  };

  const handleSendChatMessage = async (e) => {
    if (e) e.preventDefault();
    if (!selectedIssueId) return;
    if (!chatInputText.trim() && pendingAttachments.length === 0 && chatStatusChange === String(issueDetail?.status?.id) && chatDoneRatioChange === issueDetail?.done_ratio) {
      return;
    }
    setSendingChat(true);
    setChatError("");

    try {
      const uploadedTokens = [];
      for (const item of pendingAttachments) {
        const formData = new FormData();
        formData.append("file", item.file, item.name);
        const upRes = await fetch("/api/redmine/upload", {
          method: "POST",
          body: formData,
        });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error || `Failed to upload ${item.name}`);
        uploadedTokens.push({
          token: upData.token,
          filename: item.name,
          content_type: item.type,
        });
      }

      const payload = {
        notes: chatInputText.trim() || undefined,
        uploads: uploadedTokens.length > 0 ? uploadedTokens : undefined,
        statusId: chatStatusChange ? Number(chatStatusChange) : undefined,
        doneRatio: chatDoneRatioChange !== null ? Number(chatDoneRatioChange) : undefined,
      };

      const res = await fetch(`/api/redmine/issues/${selectedIssueId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post message to Redmine");

      pendingAttachments.forEach((a) => {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      });
      setPendingAttachments([]);
      setChatInputText("");

      await openIssueDetail(selectedIssueId, true);
      fetchIssues(true);
    } catch (err) {
      setChatError(err.message || "Failed to send message");
    } finally {
      setSendingChat(false);
    }
  };

  const openLogTimeModal = (issue, e) => {
    if (e) e.stopPropagation();
    setLogTimeTargetIssue(issue);
    setLogHours("");
    setLogComments("");
    setLogSpentOn(new Date().toISOString().slice(0, 10));
    setLogTimeMsg("");
    setLogTimeError("");

    const codingAct = meta.timeEntryActivities?.find(
      (a) => a.name?.toLowerCase().includes("coding") || a.name?.toLowerCase().includes("development")
    ) || meta.timeEntryActivities?.[0];
    if (codingAct) setLogActivityId(String(codingAct.id));

    setShowLogTimeModal(true);
  };

  const handleSaveLogTime = async (e) => {
    e.preventDefault();
    if (!logTimeTargetIssue || !logHours || !logActivityId) return;
    setSavingLogTime(true);
    setLogTimeError("");
    setLogTimeMsg("");

    try {
      const res = await fetch("/api/redmine/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId: logTimeTargetIssue.id,
          hours: Number(logHours),
          activityId: Number(logActivityId),
          comments: logComments.trim(),
          spentOn: logSpentOn,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to log time in Redmine");

      setLogTimeMsg("Work time logged successfully in Redmine.");
      setTimeout(() => {
        setShowLogTimeModal(false);
        setLogTimeMsg("");
        fetchIssues(true);
        if (selectedIssueId && selectedIssueId === logTimeTargetIssue.id) {
          openIssueDetail(selectedIssueId, true);
        }
      }, 900);
    } catch (err) {
      setLogTimeError(err.message || "Failed to log work time");
    } finally {
      setSavingLogTime(false);
    }
  };

  // Open Assign Local Path Modal
  const openAssignModal = (project, e) => {
    if (e) e.stopPropagation();
    setAssignTargetProject(project);
    setAssignPathInput(project.localPath || "");
    setAssignMsg("");
    setAssignError("");
    setShowAssignModal(true);
  };

  const handleSaveProjectPath = async (e) => {
    if (e) e.preventDefault();
    if (!assignTargetProject) return;
    setAssigningPath(true);
    setAssignMsg("");
    setAssignError("");

    try {
      const res = await fetch("/api/redmine/projects/assign-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: assignTargetProject.id,
          path: assignPathInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign project path");

      setAssignMsg(assignPathInput.trim() ? "Local path assigned successfully." : "Local path assignment cleared.");
      setTimeout(() => {
        setShowAssignModal(false);
        setAssignMsg("");
        fetchProjects(true);
      }, 800);
    } catch (err) {
      setAssignError(err.message || "Failed to save project path assignment");
    } finally {
      setAssigningPath(false);
    }
  };

  const handleClearProjectPath = async () => {
    if (!assignTargetProject) return;
    setAssigningPath(true);
    setAssignMsg("");
    setAssignError("");

    try {
      const res = await fetch("/api/redmine/projects/assign-path", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: assignTargetProject.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to clear project path");

      setAssignPathInput("");
      setAssignMsg("Assignment cleared.");
      setTimeout(() => {
        setShowAssignModal(false);
        setAssignMsg("");
        fetchProjects(true);
      }, 800);
    } catch (err) {
      setAssignError(err.message || "Failed to clear path");
    } finally {
      setAssigningPath(false);
    }
  };

  // Quick Open in Chat Session with preloaded workspace
  const [spawningIssueId, setSpawningIssueId] = useState(null);

  const handleSpawnTaskSession = async (issue, e) => {
    if (e) e.stopPropagation();
    if (!issue || spawningIssueId) return;
    setSpawningIssueId(issue.id);

    try {
      const res = await fetch("/api/redmine/tasks/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: issue.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start AI session");

      fetchIssues(false);
      if (data.sessionId) {
        router.push(`/dashboard/chat?sessionId=${data.sessionId}`);
      }
    } catch (err) {
      alert(`Error starting AI session: ${err.message}`);
    } finally {
      setSpawningIssueId(null);
    }
  };

  const handleSetLocalTaskStatus = async (issueId, status, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch("/api/redmine/tasks/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update local status");
      fetchIssues(false);
      if (issueDetail && (issueDetail.id === issueId || String(issueDetail.id) === String(issueId))) {
        setIssueDetail((prev) => (prev ? { ...prev, localStatus: status } : prev));
      }
    } catch (err) {
      alert(`Error updating local status: ${err.message}`);
    }
  };

  const handleOpenInChat = async (project, e) => {
    if (e) e.stopPropagation();
    if (!project.localPath) return;

    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Redmine: ${project.name}`,
          workspacePath: project.localPath,
          codebase: project.localPath,
        }),
      });

      const session = await res.json();
      if (session?.id) {
        router.push(`/dashboard/chat?session=${session.id}`);
      } else {
        router.push(`/dashboard/chat?workspace=${encodeURIComponent(project.localPath)}`);
      }
    } catch {
      router.push(`/dashboard/chat?workspace=${encodeURIComponent(project.localPath)}`);
    }
  };

  const handleFilterTasksByProject = (projectId, e) => {
    if (e) e.stopPropagation();
    setProjectFilter(String(projectId));
    setActiveTab("tasks");
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingConfig(true);
    setConfigMsg("");

    try {
      const res = await fetch("/api/redmine/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: cfgBaseUrl.trim(),
          apiKey: cfgApiKey.trim(),
          userEmail: cfgEmail.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to verify and save Redmine config");

      setConfigMsg("Redmine connection verified and saved.");
      loadMeta();
      fetchIssues(true);
      if (activeTab === "projects") fetchProjects(true);
      setTimeout(() => setShowConfigModal(false), 1200);
    } catch (err) {
      setConfigMsg(`Error: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  const metrics = useMemo(() => {
    let readyCount = 0;
    let inProgressCount = 0;
    let doneCount = 0;
    let totalSpent = 0;

    for (const item of issues) {
      const s = (item.status?.name || "").toLowerCase();
      if (s.includes("ready") || s.includes("start")) readyCount++;
      else if (s.includes("progress") || s.includes("doing") || s.includes("dev")) inProgressCount++;
      else if (s.includes("done") || s.includes("close") || s.includes("resolved")) doneCount++;
      totalSpent += Number(item.spent_hours || item.total_spent_hours || 0);
    }

    return { readyCount, inProgressCount, doneCount, totalSpent: totalSpent.toFixed(1) };
  }, [issues]);

  const projectMetrics = useMemo(() => {
    let assignedCount = 0;
    let gitCount = 0;

    for (const p of projectsList) {
      if (p.localPath) {
        assignedCount++;
        if (p.isGitRepo) gitCount++;
      }
    }

    return {
      total: projectsList.length,
      assignedCount,
      unassignedCount: projectsList.length - assignedCount,
      gitCount,
    };
  }, [projectsList]);

  // Filtered projects list
  const filteredProjects = useMemo(() => {
    return projectsList.filter((p) => {
      if (projectPathFilter === "assigned" && !p.localPath) return false;
      if (projectPathFilter === "unassigned" && p.localPath) return false;

      if (projectSearchQuery.trim()) {
        const q = projectSearchQuery.toLowerCase().trim();
        const matchName = p.name && p.name.toLowerCase().includes(q);
        const matchId = p.identifier && p.identifier.toLowerCase().includes(q);
        const matchNum = String(p.id).includes(q);
        const matchPath = p.localPath && p.localPath.toLowerCase().includes(q);
        const matchDesc = p.description && p.description.toLowerCase().includes(q);
        return matchName || matchId || matchNum || matchPath || matchDesc;
      }
      return true;
    });
  }, [projectsList, projectPathFilter, projectSearchQuery]);

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-[14px] bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0 shadow-sm">
            <span className="material-symbols-outlined text-[24px]">task_alt</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-text-main tracking-tight">Redmine Workspace</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium flex items-center gap-1.5 shadow-xs">
                <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5 truncate">
              {meta.config?.userName
                ? `Assigned to ${meta.config.userName} (${meta.config.userEmail || "azaky"})`
                : "Active task monitoring, issue management, and local project workspace linking"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
          <a
            href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/my/page`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-main text-xs font-medium border border-border shadow-xs transition min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[16px] text-text-muted">open_in_new</span>
            Open Web
          </a>

          <button
            onClick={() => {
              if (activeTab === "tasks") fetchIssues(true);
              else fetchProjects(true);
            }}
            disabled={refreshing || loading || projectsRefreshing || projectsLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-main text-xs font-medium border border-border shadow-xs transition disabled:opacity-50 min-h-[44px]"
            title="Refresh data"
          >
            <span
              className={`material-symbols-outlined text-[16px] text-text-muted ${
                refreshing || projectsRefreshing ? "animate-spin text-primary" : ""
              }`}
            >
              refresh
            </span>
            Refresh
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            Config
          </button>
        </div>
      </div>

      {/* Primary Tab Navigation: Tasks vs List Project */}
      <div className="flex items-center gap-2 border-b border-border pb-1">
        <button
          onClick={() => setActiveTab("tasks")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm transition-all min-h-[44px] cursor-pointer ${
            activeTab === "tasks"
              ? "bg-primary text-white shadow-sm shadow-primary/25 font-semibold"
              : "bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">assignment</span>
          <span>My Tasks</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === "tasks" ? "bg-white/20 text-white" : "bg-surface-2 text-text-muted"
            }`}
          >
            {totalCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("projects")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm transition-all min-h-[44px] cursor-pointer ${
            activeTab === "projects"
              ? "bg-primary text-white shadow-sm shadow-primary/25 font-semibold"
              : "bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main border border-border"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">domain</span>
          <span>List Project</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
              activeTab === "projects" ? "bg-white/20 text-white" : "bg-surface-2 text-text-muted"
            }`}
          >
            {projectsList.length || meta.projects.length}
          </span>
        </button>
      </div>

      {/* ──────────────── TAB 1: TASKS ──────────────── */}
      {activeTab === "tasks" && (
        <>
          {/* Metric Cards */}
          <section aria-label="Task Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-primary/40 transition-all">
              <div className="flex items-center justify-between text-text-muted mb-1.5">
                <span className="text-xs font-medium">Total Assigned</span>
                <span className="material-symbols-outlined text-[20px] text-text-subtle">assignment</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{totalCount}</div>
              <span className="text-[11px] text-text-subtle block mt-0.5">Current filter scope</span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-blue-500/40 transition-all">
              <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1.5">
                <span className="text-xs font-medium">Ready To Start</span>
                <span className="material-symbols-outlined text-[20px]">play_circle</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{metrics.readyCount}</div>
              <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70 block mt-0.5">Awaiting development</span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-amber-500/40 transition-all">
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1.5">
                <span className="text-xs font-medium">In Progress</span>
                <span className="material-symbols-outlined text-[20px]">engineering</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{metrics.inProgressCount}</div>
              <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70 block mt-0.5">Active work items</span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-emerald-500/40 transition-all">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1.5">
                <span className="text-xs font-medium">Total Logged Time</span>
                <span className="material-symbols-outlined text-[20px]">schedule</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{metrics.totalSpent}h</div>
              <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 block mt-0.5">
                {metrics.doneCount} issues closed
              </span>
            </div>
          </section>

          {/* Filter and Search Bar */}
          <section aria-label="Filters" className="bg-surface border border-border rounded-[14px] p-3 sm:p-4 shadow-[var(--shadow-soft)] flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex-1 flex items-center gap-2 bg-bg border border-border rounded-xl px-3.5 py-2 max-w-md focus-within:border-primary transition-colors">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search</span>
              <input
                type="text"
                placeholder="Search by subject, issue ID, or project..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-xs text-text-main placeholder:text-text-muted flex-1"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-text-muted hover:text-text-main flex items-center p-0.5"
                  aria-label="Clear search"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by Status"
                className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors min-h-[44px]"
              >
                <option value="open">Status: Open</option>
                <option value="*">Status: All (Open & Closed)</option>
                <option value="closed">Status: Closed</option>
                {meta.statuses.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    Status: {s.name}
                  </option>
                ))}
              </select>

              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                aria-label="Filter by Project"
                className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors max-w-[220px] truncate min-h-[44px]"
              >
                <option value="">All Projects</option>
                {meta.projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>

              <select
                value={trackerFilter}
                onChange={(e) => setTrackerFilter(e.target.value)}
                aria-label="Filter by Tracker"
                className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors min-h-[44px]"
              >
                <option value="">All Trackers</option>
                {meta.trackers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Error State */}
          {error && (
            <div className="p-4 rounded-[14px] bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[20px] shrink-0">error</span>
                <span>{error}</span>
              </div>
              <button
                onClick={() => fetchIssues(true)}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-200 font-medium text-xs transition shrink-0 min-h-[44px]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-16 rounded-[14px] bg-surface border border-border-subtle animate-pulse" />
              ))}
            </div>
          ) : issues.length === 0 ? (
            /* Empty State */
            <div className="text-center py-16 border border-dashed border-border rounded-[14px] bg-surface shadow-[var(--shadow-soft)]">
              <span className="material-symbols-outlined text-[48px] text-text-subtle mx-auto mb-3 block">
                task
              </span>
              <h3 className="text-sm font-semibold text-text-main">No Redmine Tasks Found</h3>
              <p className="text-xs text-text-muted max-w-sm mx-auto mt-1 mb-4">
                {searchQuery || projectFilter || trackerFilter
                  ? "No tasks match the active filters. Try resetting search or project filters."
                  : "No issues currently assigned to you with the selected status."}
              </p>
              {(searchQuery || projectFilter || trackerFilter || statusFilter !== "open") && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setProjectFilter("");
                    setTrackerFilter("");
                    setStatusFilter("open");
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-main border border-border font-medium text-xs transition min-h-[44px]"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            /* Table of Issues with Log Time column */
            <div className="border border-border rounded-[14px] overflow-hidden bg-surface shadow-[var(--shadow-soft)]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-2 border-b border-border text-text-muted uppercase tracking-wider text-[11px] font-semibold">
                    <tr>
                      <th className="px-4 py-3.5 w-20"># ID</th>
                      <th className="px-4 py-3.5">Tracker & Project</th>
                      <th className="px-4 py-3.5">Subject</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5">Priority</th>
                      <th className="px-4 py-3.5 whitespace-nowrap">Log Time</th>
                      <th className="px-4 py-3.5 w-28">% Done</th>
                      <th className="px-4 py-3.5">Updated</th>
                      <th className="px-4 py-3.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {issues.map((issue) => {
                      const spent = Number(issue.spent_hours ?? issue.total_spent_hours ?? 0);
                      const estimated = issue.estimated_hours ? Number(issue.estimated_hours) : null;

                      return (
                        <tr
                          key={issue.id}
                          onClick={() => openIssueDetail(issue.id)}
                          className="hover:bg-surface-2/60 cursor-pointer transition-colors group"
                        >
                          <td className="px-4 py-3.5 font-mono text-xs text-primary font-semibold group-hover:underline">
                            #{issue.id}
                          </td>

                          <td className="px-4 py-3.5 max-w-[200px]">
                            <div className="font-medium text-text-main truncate" title={issue.project?.name}>
                              {issue.project?.name || "General"}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-text-muted font-mono mt-0.5 flex-wrap">
                              <span>{issue.tracker?.name || "Task"}</span>
                              {issue.localPath ? (
                                <span
                                  className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]"
                                  title={`Local folder: ${issue.localPath}`}
                                >
                                  <span className="material-symbols-outlined text-[11px]">folder_open</span>
                                  {issue.localPath.split(/[\\/]/).filter(Boolean).pop()}
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 max-w-sm">
                            <div className="font-medium text-text-main truncate" title={issue.subject}>
                              {issue.subject}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex flex-col gap-1 items-start">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeClass(
                                  issue.status?.name
                                )}`}
                              >
                                {issue.status?.name || "Open"}
                              </span>

                              {issue.localStatus === "working" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30 animate-pulse">
                                  <span className="size-1.5 rounded-full bg-sky-500" />
                                  9Router: Working
                                </span>
                              )}
                              {issue.localStatus === "done" && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                                  <span className="material-symbols-outlined text-[12px]">task_alt</span>
                                  9Router: Done
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${getPriorityBadgeClass(
                                issue.priority?.name
                              )}`}
                            >
                              {issue.priority?.name || "Normal"}
                            </span>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => openLogTimeModal(issue, e)}
                                className="p-1 rounded-md bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-primary border border-border-subtle transition flex items-center justify-center min-h-[32px] min-w-[32px]"
                                title="Log work time for this task"
                              >
                                <span className="material-symbols-outlined text-[15px]">schedule</span>
                              </button>
                              <span className="font-mono text-xs text-text-main font-medium">
                                {spent.toFixed(1)}h
                              </span>
                              {estimated ? (
                                <span className="text-[11px] text-text-muted font-mono" title={`Estimated: ${estimated}h`}>
                                  / {estimated}h
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden border border-border-subtle min-w-[50px]">
                                <div
                                  className="h-full bg-primary rounded-full transition-all"
                                  style={{ width: `${issue.done_ratio || 0}%` }}
                                />
                              </div>
                              <span className="text-[11px] text-text-muted font-mono w-7 text-right">
                                {issue.done_ratio || 0}%
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-text-muted text-[11px] whitespace-nowrap">
                            {issue.updated_on ? new Date(issue.updated_on).toLocaleDateString() : "-"}
                          </td>

                          <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {issue.localPath ? (
                                issue.localStatus === "working" ? (
                                  <button
                                    onClick={() => router.push(`/dashboard/chat?sessionId=${issue.localSessionId}`)}
                                    className="px-2.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 font-medium text-xs transition border border-sky-500/30 inline-flex items-center gap-1.5 shadow-2xs min-h-[36px]"
                                    title="Open working session in Chat"
                                  >
                                    <span className="material-symbols-outlined text-[14px] animate-spin text-sky-500">progress_activity</span>
                                    Open Chat
                                  </button>
                                ) : issue.localStatus === "done" ? (
                                  <button
                                    onClick={() => router.push(`/dashboard/chat?sessionId=${issue.localSessionId}`)}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium text-xs transition border border-emerald-500/30 inline-flex items-center gap-1 shadow-2xs min-h-[36px]"
                                    title="View completed session in Chat"
                                  >
                                    <span className="material-symbols-outlined text-[14px] text-emerald-500">task_alt</span>
                                    Done · Chat
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => handleSpawnTaskSession(issue, e)}
                                    disabled={spawningIssueId === issue.id}
                                    className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-medium text-xs transition inline-flex items-center gap-1.5 shadow-2xs min-h-[36px] disabled:opacity-50"
                                    title="Spawn session and run AI on this project"
                                  >
                                    <span className="material-symbols-outlined text-[15px]">
                                      {spawningIssueId === issue.id ? "sync" : "smart_toy"}
                                    </span>
                                    {spawningIssueId === issue.id ? "Starting..." : "Work with AI"}
                                  </button>
                                )
                              ) : (
                                <button
                                  onClick={() => {
                                    setActiveTab("projects");
                                    setProjectSearch(issue.project?.name || "");
                                  }}
                                  className="px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main text-[11px] transition border border-dashed border-border inline-flex items-center gap-1 min-h-[36px]"
                                  title="Assign local workspace path to enable AI worker"
                                >
                                  <span className="material-symbols-outlined text-[13px]">folder_open</span>
                                  Assign Path
                                </button>
                              )}

                              <button
                                onClick={() => openLogTimeModal(issue)}
                                className="px-2 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-primary font-medium text-xs transition border border-border inline-flex items-center gap-1 shadow-2xs min-h-[36px]"
                                title="Log work time"
                              >
                                <span className="material-symbols-outlined text-[14px]">more_time</span>
                              </button>

                              <button
                                onClick={() => openIssueDetail(issue.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main font-medium text-xs transition border border-border inline-flex items-center gap-0.5 shadow-2xs min-h-[36px]"
                              >
                                Detail
                                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ──────────────── TAB 2: LIST PROJECT ──────────────── */}
      {activeTab === "projects" && (
        <>
          {/* Projects Metric Cards */}
          <section aria-label="Project Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-primary/40 transition-all">
              <div className="flex items-center justify-between text-text-muted mb-1.5">
                <span className="text-xs font-medium">Total Redmine Projects</span>
                <span className="material-symbols-outlined text-[20px] text-text-subtle">domain</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{projectMetrics.total}</div>
              <span className="text-[11px] text-text-subtle block mt-0.5">Projects from Redmine</span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-emerald-500/40 transition-all">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 mb-1.5">
                <span className="text-xs font-medium">Assigned Local Path</span>
                <span className="material-symbols-outlined text-[20px]">folder_check</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{projectMetrics.assignedCount}</div>
              <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 block mt-0.5">
                Linked to workspace folder
              </span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-amber-500/40 transition-all">
              <div className="flex items-center justify-between text-amber-600 dark:text-amber-400 mb-1.5">
                <span className="text-xs font-medium">Unassigned Projects</span>
                <span className="material-symbols-outlined text-[20px]">folder_off</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{projectMetrics.unassignedCount}</div>
              <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70 block mt-0.5">
                No local folder linked yet
              </span>
            </div>

            <div className="bg-surface border border-border rounded-[14px] p-4 sm:p-5 shadow-[var(--shadow-soft)] hover:border-blue-500/40 transition-all">
              <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 mb-1.5">
                <span className="text-xs font-medium">Git Repositories</span>
                <span className="material-symbols-outlined text-[20px]">commit</span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-text-main">{projectMetrics.gitCount}</div>
              <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70 block mt-0.5">
                Valid Git repos detected
              </span>
            </div>
          </section>

          {/* Search & Filter Bar for Projects */}
          <section aria-label="Project Filters" className="bg-surface border border-border rounded-[14px] p-3 sm:p-4 shadow-[var(--shadow-soft)] flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="flex-1 flex items-center gap-2 bg-bg border border-border rounded-xl px-3.5 py-2 max-w-md focus-within:border-primary transition-colors">
              <span className="material-symbols-outlined text-[18px] text-text-muted">search</span>
              <input
                type="text"
                placeholder="Search projects by name, identifier, or local path..."
                value={projectSearchQuery}
                onChange={(e) => setProjectSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-xs text-text-main placeholder:text-text-muted flex-1"
              />
              {projectSearchQuery && (
                <button
                  onClick={() => setProjectSearchQuery("")}
                  className="text-text-muted hover:text-text-main flex items-center p-0.5"
                  aria-label="Clear project search"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-bg border border-border rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setProjectPathFilter("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition min-h-[36px] ${
                    projectPathFilter === "all"
                      ? "bg-surface text-primary shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  All ({projectsList.length})
                </button>
                <button
                  type="button"
                  onClick={() => setProjectPathFilter("assigned")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition min-h-[36px] ${
                    projectPathFilter === "assigned"
                      ? "bg-surface text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Assigned ({projectMetrics.assignedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setProjectPathFilter("unassigned")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition min-h-[36px] ${
                    projectPathFilter === "unassigned"
                      ? "bg-surface text-amber-600 dark:text-amber-400 shadow-xs font-semibold"
                      : "text-text-muted hover:text-text-main"
                  }`}
                >
                  Unassigned ({projectMetrics.unassignedCount})
                </button>
              </div>
            </div>
          </section>

          {/* Project Error State */}
          {projectsError && (
            <div className="p-4 rounded-[14px] bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[20px] shrink-0">error</span>
                <span>{projectsError}</span>
              </div>
              <button
                onClick={() => fetchProjects(true)}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-200 font-medium text-xs transition shrink-0 min-h-[44px]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Projects Loading State */}
          {projectsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-16 rounded-[14px] bg-surface border border-border-subtle animate-pulse" />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            /* Projects Empty State */
            <div className="text-center py-16 border border-dashed border-border rounded-[14px] bg-surface shadow-[var(--shadow-soft)]">
              <span className="material-symbols-outlined text-[48px] text-text-subtle mx-auto mb-3 block">
                folder_open
              </span>
              <h3 className="text-sm font-semibold text-text-main">No Projects Found</h3>
              <p className="text-xs text-text-muted max-w-sm mx-auto mt-1 mb-4">
                {projectSearchQuery || projectPathFilter !== "all"
                  ? "No projects match the active search or filter. Try clearing filters."
                  : "No projects loaded from Redmine. Please check connection and permissions."}
              </p>
              {(projectSearchQuery || projectPathFilter !== "all") && (
                <button
                  onClick={() => {
                    setProjectSearchQuery("");
                    setProjectPathFilter("all");
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-main border border-border font-medium text-xs transition min-h-[44px]"
                >
                  Reset Project Filters
                </button>
              )}
            </div>
          ) : (
            /* Projects Table */
            <div className="border border-border rounded-[14px] overflow-hidden bg-surface shadow-[var(--shadow-soft)]">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-2 border-b border-border text-text-muted uppercase tracking-wider text-[11px] font-semibold">
                    <tr>
                      <th className="px-4 py-3.5 w-16"># ID</th>
                      <th className="px-4 py-3.5 min-w-[220px]">Project Name & Identifier</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5 min-w-[260px]">Assigned Local Path</th>
                      <th className="px-4 py-3.5 text-right min-w-[240px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {filteredProjects.map((project) => {
                      const hasPath = Boolean(project.localPath);
                      const isGit = project.isGitRepo;
                      const pathExists = project.pathExists;

                      return (
                        <tr
                          key={project.id}
                          className="hover:bg-surface-2/60 transition-colors group"
                        >
                          <td className="px-4 py-3.5 font-mono text-xs text-primary font-semibold">
                            #{project.id}
                          </td>

                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-text-main text-xs sm:text-sm">
                              {project.name}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="font-mono text-[11px] text-text-muted">
                                {project.identifier}
                              </span>
                              {project.description && (
                                <>
                                  <span className="text-text-subtle">•</span>
                                  <span className="text-[11px] text-text-subtle truncate max-w-xs" title={project.description}>
                                    {project.description}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                project.status === 1 || project.status === undefined
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-surface-2 text-text-muted border-border"
                              }`}
                            >
                              {project.status === 1 || project.status === undefined ? "Active" : "Closed"}
                            </span>
                          </td>

                          {/* Assigned Local Path Column */}
                          <td className="px-4 py-3.5">
                            {hasPath ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-[11px] text-text-main bg-bg px-2 py-1 rounded-md border border-border inline-block break-all max-w-md">
                                    {project.localPath}
                                  </span>

                                  {pathExists === true && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                      <span className="size-1 rounded-full bg-emerald-500" />
                                      Folder exists
                                    </span>
                                  )}

                                  {pathExists === false && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                      <span className="size-1 rounded-full bg-rose-500" />
                                      Not found on disk
                                    </span>
                                  )}

                                  {isGit && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                      <span className="material-symbols-outlined text-[11px]">commit</span>
                                      Git repo
                                    </span>
                                  )}
                                </div>

                                {project.assignedAt && (
                                  <div className="text-[10px] text-text-subtle font-mono">
                                    Assigned: {new Date(project.assignedAt).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-text-subtle text-[11px] italic">
                                No local workspace assigned
                              </span>
                            )}
                          </td>

                          {/* Action Buttons */}
                          <td className="px-4 py-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {hasPath && (
                                <button
                                  type="button"
                                  onClick={(e) => handleOpenInChat(project, e)}
                                  className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-medium text-xs shadow-xs shadow-primary/20 transition inline-flex items-center gap-1 min-h-[36px]"
                                  title="Open new chat session with this workspace"
                                >
                                  <span className="material-symbols-outlined text-[15px]">chat</span>
                                  Open in Chat
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={(e) => handleFilterTasksByProject(project.id, e)}
                                className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main font-medium text-xs transition border border-border inline-flex items-center gap-1 shadow-2xs min-h-[36px]"
                                title="View tasks for this project"
                              >
                                <span className="material-symbols-outlined text-[14px] text-text-muted">list_alt</span>
                                Tasks
                              </button>

                              <button
                                type="button"
                                onClick={(e) => openAssignModal(project, e)}
                                className={`px-2.5 py-1.5 rounded-lg font-medium text-xs transition border inline-flex items-center gap-1 shadow-2xs min-h-[36px] ${
                                  hasPath
                                    ? "bg-surface-2 hover:bg-surface-3 text-text-main border-border"
                                    : "bg-surface-2 hover:bg-surface-3 text-primary border-primary/30"
                                }`}
                                title={hasPath ? "Change assigned local path" : "Assign local folder path"}
                              >
                                <span className="material-symbols-outlined text-[15px]">
                                  {hasPath ? "edit" : "add_link"}
                                </span>
                                {hasPath ? "Edit Path" : "Assign Path"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ──────────────── MODAL: ASSIGN LOCAL PATH ──────────────── */}
      {showAssignModal && assignTargetProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-[14px] w-full max-w-lg overflow-hidden shadow-2xl text-text-main">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-2/40">
              <div className="min-w-0 pr-3">
                <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">folder_open</span>
                  Assign Local Workspace Path
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5 truncate">
                  #{assignTargetProject.id}: {assignTargetProject.name} ({assignTargetProject.identifier})
                </p>
              </div>
              <button
                onClick={() => setShowAssignModal(false)}
                className="text-text-muted hover:text-text-main flex items-center p-1"
                aria-label="Close assign modal"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveProjectPath} className="p-5 space-y-4">
              {assignMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{assignMsg}</span>
                </div>
              )}

              {assignError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{assignError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">
                  Local Folder Path
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. F:\project\ckb-customer-portal"
                    value={assignPathInput}
                    onChange={(e) => setAssignPathInput(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2.5 text-xs font-mono text-text-main placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                  />
                  {assignPathInput && (
                    <button
                      type="button"
                      onClick={() => setAssignPathInput("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
                      title="Clear path"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  Enter absolute folder path on host where this project repository is located.
                </p>
              </div>

              {/* Suggestions from Detected Workspaces */}
              {knownWorkspaces.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-text-muted flex items-center justify-between">
                    <span>Suggested Workspaces ({knownWorkspaces.length})</span>
                    <span className="text-[10px] text-text-subtle">Click to autofill</span>
                  </label>

                  <div className="max-h-40 overflow-y-auto space-y-1 bg-bg p-2 rounded-xl border border-border custom-scrollbar">
                    {knownWorkspaces.map((ws) => {
                      const isMatch =
                        assignTargetProject.identifier &&
                        ws.name.toLowerCase().includes(assignTargetProject.identifier.toLowerCase().replace(/_/g, "-"));
                      const isSelected = assignPathInput.toLowerCase() === ws.path.toLowerCase();

                      return (
                        <div
                          key={ws.path}
                          onClick={() => setAssignPathInput(ws.path)}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                            isSelected
                              ? "bg-primary/10 border border-primary/30 text-text-main"
                              : isMatch
                              ? "bg-surface-2 hover:bg-surface-3 border border-primary/20 text-text-main"
                              : "bg-surface/60 hover:bg-surface-2 border border-border-subtle text-text-muted hover:text-text-main"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-text-main">{ws.name}</span>
                              {isMatch && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-primary/15 text-primary font-medium">
                                  Smart match
                                </span>
                              )}
                              {ws.isGit && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                  Git
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-text-subtle block truncate mt-0.5">
                              {ws.path}
                            </span>
                          </div>

                          <span className="material-symbols-outlined text-[16px] text-text-subtle shrink-0">
                            {isSelected ? "check_circle" : "arrow_forward"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center justify-between gap-2">
                {assignTargetProject.localPath ? (
                  <button
                    type="button"
                    onClick={handleClearProjectPath}
                    disabled={assigningPath}
                    className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium border border-rose-500/20 transition disabled:opacity-50 min-h-[44px]"
                  >
                    Remove Path
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAssignModal(false)}
                    className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-medium text-text-main border border-border transition min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={assigningPath || !assignPathInput.trim()}
                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
                  >
                    {assigningPath && (
                      <span className="material-symbols-outlined text-[16px] animate-spin">
                        progress_activity
                      </span>
                    )}
                    Save Assignment
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL: ISSUE DETAIL & CHAT ──────────────── */}
      {selectedIssueId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-[14px] w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-text-main">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-surface-2/40 shrink-0">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono text-xs font-semibold">
                    #{selectedIssueId}
                  </span>
                  <span className="text-xs text-text-muted font-medium truncate max-w-[200px]">
                    {issueDetail?.project?.name}
                  </span>
                  <span className="text-text-subtle">•</span>
                  <span className="text-xs text-text-muted">
                    {issueDetail?.tracker?.name}
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-text-main truncate">
                  {issueDetail?.subject || "Loading task details..."}
                </h3>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {issueDetail && issueDetail.localPath ? (
                  issueDetail.localStatus === "working" ? (
                    <button
                      onClick={() => router.push(`/dashboard/chat?sessionId=${issueDetail.localSessionId}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 text-xs font-semibold border border-sky-500/30 transition min-h-[44px]"
                    >
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                      <span>Working in Chat</span>
                    </button>
                  ) : issueDetail.localStatus === "done" ? (
                    <button
                      onClick={() => router.push(`/dashboard/chat?sessionId=${issueDetail.localSessionId}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-semibold border border-emerald-500/30 transition min-h-[44px]"
                    >
                      <span className="material-symbols-outlined text-[16px] text-emerald-500">task_alt</span>
                      <span>Done · View Chat</span>
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleSpawnTaskSession(issueDetail, e)}
                      disabled={spawningIssueId === issueDetail.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition min-h-[44px] disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {spawningIssueId === issueDetail.id ? "sync" : "smart_toy"}
                      </span>
                      <span>{spawningIssueId === issueDetail.id ? "Starting..." : "Work with AI"}</span>
                    </button>
                  )
                ) : issueDetail ? (
                  <button
                    onClick={() => {
                      closeIssueDetail();
                      setActiveTab("projects");
                      setProjectSearch(issueDetail.project?.name || "");
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main border border-dashed border-border text-xs font-medium min-h-[44px]"
                  >
                    <span className="material-symbols-outlined text-[15px]">folder_open</span>
                    <span className="hidden sm:inline">Assign Path</span>
                  </button>
                ) : null}

                {issueDetail && (
                  <button
                    onClick={() => openLogTimeModal(issueDetail)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-main border border-border text-xs font-medium transition min-h-[44px]"
                  >
                    <span className="material-symbols-outlined text-[16px] text-primary">more_time</span>
                    <span className="hidden sm:inline">Log Time</span>
                  </button>
                )}

                <a
                  href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/issues/${selectedIssueId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main border border-border transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                  title="Open on Redmine"
                >
                  <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                </a>

                <button
                  onClick={closeIssueDetail}
                  className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main border border-border transition flex items-center justify-center min-h-[44px] min-w-[44px]"
                  aria-label="Close detail modal"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar" ref={chatContainerRef}>
              {detailLoading ? (
                <div className="space-y-4">
                  <div className="h-16 rounded-xl bg-surface-2 animate-pulse" />
                  <div className="h-32 rounded-xl bg-surface-2 animate-pulse" />
                  <div className="h-48 rounded-xl bg-surface-2 animate-pulse" />
                </div>
              ) : detailError ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{detailError}</span>
                </div>
              ) : issueDetail ? (
                <>
                  {/* Meta Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 bg-bg p-3 sm:p-3.5 rounded-xl border border-border text-xs">
                    <div>
                      <span className="text-text-muted block text-[11px]">Status & Progress</span>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusBadgeClass(
                            issueDetail.status?.name
                          )}`}
                        >
                          {issueDetail.status?.name}
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">
                          {issueDetail.done_ratio ?? 0}%
                        </span>
                      </div>
                    </div>

                    <div>
                      <span className="text-text-muted block text-[11px]">Priority</span>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium border ${getPriorityBadgeClass(
                          issueDetail.priority?.name
                        )}`}
                      >
                        {issueDetail.priority?.name}
                      </span>
                    </div>

                    <div>
                      <span className="text-text-muted block text-[11px]">Time Logged / Est</span>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="font-mono text-xs text-text-main font-semibold">
                          {Number(issueDetail.spent_hours ?? issueDetail.total_spent_hours ?? 0).toFixed(1)}h
                        </span>
                        {issueDetail.estimated_hours ? (
                          <span className="text-text-muted font-mono text-[11px]">
                            / {issueDetail.estimated_hours}h
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <span className="text-text-muted block text-[11px]">Assigned To</span>
                      <span className="font-medium text-text-main block mt-1 truncate">
                        {issueDetail.assigned_to?.name || "-"}
                      </span>
                    </div>
                  </div>

                  {/* ──────────────── 9ROUTER WORKSPACE & AI STATUS CARD ──────────────── */}
                  <div className="bg-surface border border-border rounded-xl p-3.5 sm:p-4 text-xs space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-primary">smart_toy</span>
                        <span className="font-semibold text-text-main text-xs sm:text-sm">9Router AI Worker</span>
                        {issueDetail.localStatus === "working" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/30 animate-pulse">
                            <span className="size-1.5 rounded-full bg-sky-500" />
                            Working in Background
                          </span>
                        )}
                        {issueDetail.localStatus === "done" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                            <span className="material-symbols-outlined text-[13px]">task_alt</span>
                            Done in 9Router
                          </span>
                        )}
                        {!issueDetail.localStatus && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-2 text-text-muted border border-border">
                            Not started
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        {issueDetail.localPath ? (
                          <>
                            {issueDetail.localSessionId && (
                              <button
                                type="button"
                                onClick={() => router.push(`/dashboard/chat?sessionId=${issueDetail.localSessionId}`)}
                                className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main font-medium text-xs transition border border-border inline-flex items-center gap-1 shadow-2xs min-h-[36px]"
                              >
                                <span className="material-symbols-outlined text-[15px] text-primary">chat</span>
                                Open Chat Session
                              </button>
                            )}

                            {issueDetail.localStatus !== "working" && (
                              <button
                                type="button"
                                onClick={(e) => handleSpawnTaskSession(issueDetail, e)}
                                disabled={spawningIssueId === issueDetail.id}
                                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white font-medium text-xs transition inline-flex items-center gap-1.5 shadow-2xs min-h-[36px] disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-[16px]">
                                  {spawningIssueId === issueDetail.id ? "sync" : "play_arrow"}
                                </span>
                                {spawningIssueId === issueDetail.id
                                  ? "Starting..."
                                  : issueDetail.localStatus === "done"
                                  ? "Re-run with AI"
                                  : "Start AI on Task"}
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              closeIssueDetail();
                              setActiveTab("projects");
                              setProjectSearch(issueDetail.project?.name || "");
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium text-xs transition border border-amber-500/30 inline-flex items-center gap-1.5 min-h-[36px]"
                          >
                            <span className="material-symbols-outlined text-[15px]">folder_open</span>
                            Assign Local Path First
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border-subtle flex-wrap text-[11px]">
                      <div className="flex items-center gap-1.5 text-text-muted truncate max-w-md">
                        <span className="material-symbols-outlined text-[14px] text-text-subtle">folder</span>
                        <span>Workspace:</span>
                        {issueDetail.localPath ? (
                          <span className="font-mono text-text-main truncate" title={issueDetail.localPath}>
                            {issueDetail.localPath}
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 font-mono">
                            Belum ada folder lokal di-assign
                          </span>
                        )}
                      </div>

                      {/* Manual local status controls */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-text-subtle">Status 9Router:</span>
                        {issueDetail.localStatus !== "done" ? (
                          <button
                            type="button"
                            onClick={(e) => handleSetLocalTaskStatus(issueDetail.id, "done", e)}
                            className="px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-emerald-600 dark:text-emerald-400 border border-border text-[11px] font-medium transition"
                            title="Tandai Done di 9Router (tanpa mengubah status tiket Redmine di server)"
                          >
                            Mark Done
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleSetLocalTaskStatus(issueDetail.id, "working", e)}
                            className="px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-sky-600 dark:text-sky-400 border border-border text-[11px] font-medium transition"
                            title="Tandai Working di 9Router"
                          >
                            Mark Working
                          </button>
                        )}
                        {issueDetail.localStatus && (
                          <button
                            type="button"
                            onClick={(e) => handleSetLocalTaskStatus(issueDetail.id, "reset", e)}
                            className="px-1.5 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-text-subtle hover:text-rose-500 border border-border text-[10px] transition"
                            title="Reset status 9Router"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="text-[10px] text-text-subtle italic">
                      Catatan: AI tidak pernah mengubah skema atau data database langsung (jika ada alter, AI membuat file .sql). Status di atas adalah status lokal 9Router dan tidak mengubah status tiket Redmine remote.
                    </p>
                  </div>

                  {/* Task Description (Ticket Brief) */}
                  <details className="group bg-bg border border-border rounded-xl overflow-hidden transition-all" open>
                    <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer bg-surface-2/30 hover:bg-surface-2/60 transition text-xs font-semibold text-text-muted uppercase tracking-wider select-none">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-text-subtle">description</span>
                        <span>Ticket Description</span>
                        <span className="text-[11px] normal-case text-text-subtle font-normal">
                          by {issueDetail.author?.name || "Reporter"}
                        </span>
                      </div>
                      <span className="material-symbols-outlined text-[16px] text-text-subtle group-open:rotate-180 transition-transform">
                        expand_more
                      </span>
                    </summary>
                    <div className="p-4 text-xs text-text-main leading-relaxed whitespace-pre-wrap font-sans border-t border-border-subtle bg-bg">
                      {issueDetail.description || "(No description provided)"}

                      {Array.isArray(issueDetail.attachments) && issueDetail.attachments.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border-subtle">
                          <span className="text-[11px] font-medium text-text-muted block mb-2">
                            Attachments ({issueDetail.attachments.length}):
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {issueDetail.attachments.map((att) => {
                              const isImg = isImageFile(att.filename, att.content_type);
                              const proxyUrl = getAttachmentProxyUrl(att);

                              return (
                                <div
                                  key={att.id}
                                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface border border-border text-xs"
                                >
                                  {isImg ? (
                                    <button
                                      type="button"
                                      onClick={() => setActiveImagePreview({ url: proxyUrl, name: att.filename })}
                                      className="flex items-center gap-1.5 text-primary hover:underline font-medium"
                                    >
                                      <span className="material-symbols-outlined text-[16px]">image</span>
                                      <span className="truncate max-w-[140px]">{att.filename}</span>
                                    </button>
                                  ) : (
                                    <div className="flex items-center gap-1.5 font-medium text-text-main">
                                      <span className="material-symbols-outlined text-[16px] text-text-subtle">
                                        attach_file
                                      </span>
                                      <span className="truncate max-w-[140px]">{att.filename}</span>
                                    </div>
                                  )}
                                  <span className="text-[10px] text-text-muted font-mono">
                                    {formatFileSize(att.filesize)}
                                  </span>
                                  <a
                                    href={proxyUrl}
                                    download={att.filename}
                                    className="p-1 text-text-muted hover:text-text-main transition"
                                    title="Download file"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">download</span>
                                  </a>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>

                  {/* Chat / Conversation Timeline */}
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-primary">forum</span>
                        History & Comments ({issueDetail.journals?.length || 0})
                      </h4>
                      <span className="text-[11px] text-text-subtle">
                        Live thread synchronized with Redmine journals
                      </span>
                    </div>

                    <div className="space-y-3 bg-bg/50 border border-border rounded-xl p-3 sm:p-4 min-h-[220px]">
                      {(!issueDetail.journals || issueDetail.journals.length === 0) ? (
                        <div className="text-center py-8 text-text-muted text-xs">
                          <span className="material-symbols-outlined text-[32px] text-text-subtle block mb-1">
                            chat_bubble_outline
                          </span>
                          No discussion comments yet. Be the first to start the thread.
                        </div>
                      ) : (
                        issueDetail.journals.map((journal) => {
                          const hasNotes = Boolean(journal.notes?.trim());
                          const detailsList = Array.isArray(journal.details) ? journal.details : [];
                          const hasDetails = detailsList.length > 0;

                          const isCurrentUser = meta.config?.userId
                            ? journal.user?.id === meta.config.userId
                            : (journal.user?.name?.toLowerCase().includes("arfan") ||
                               journal.user?.name?.toLowerCase().includes("zaky"));

                          const journalAttachments = detailsList
                            .filter((d) => d.property === "attachment")
                            .map((d) => {
                              return (
                                issueDetail.attachments?.find(
                                  (a) => String(a.id) === String(d.name) || a.filename === d.new_value
                                ) || {
                                  id: d.name,
                                  filename: d.new_value || "attachment",
                                  content_url: `${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/attachments/download/${d.name}/${d.new_value || ""}`,
                                }
                              );
                            });

                          return (
                            <div key={journal.id} className="space-y-2">
                              {hasDetails && (
                                <div className="flex justify-center my-1.5">
                                  <div className="px-3 py-1 rounded-full bg-surface-2 border border-border text-[11px] text-text-muted flex items-center gap-1.5 shadow-xs max-w-full truncate">
                                    <span className="material-symbols-outlined text-[13px] text-text-subtle shrink-0">
                                      tune
                                    </span>
                                    <span className="font-medium text-text-main shrink-0">
                                      {journal.user?.name || "System"}
                                    </span>
                                    <span className="truncate">
                                      {detailsList
                                        .filter((d) => d.property !== "attachment")
                                        .map((d) => {
                                          const field = d.name === "status_id" ? "Status" : d.name === "done_ratio" ? "% Done" : d.name;
                                          return `${field}: ${d.old_value || "(none)"} -> ${d.new_value || "(none)"}`;
                                        })
                                        .join(", ")}
                                    </span>
                                    <span className="text-text-subtle shrink-0">•</span>
                                    <span className="text-text-subtle text-[10px] shrink-0">
                                      {new Date(journal.created_on).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  </div>
                                </div>
                              )}

                              {(hasNotes || journalAttachments.length > 0) && (
                                <div className={`flex items-start gap-2.5 ${isCurrentUser ? "justify-end" : "justify-start"}`}>
                                  {!isCurrentUser && (
                                    <div className="size-8 rounded-full bg-surface-2 border border-border text-text-main flex items-center justify-center font-bold text-[11px] shrink-0 shadow-xs">
                                      {getInitials(journal.user?.name)}
                                    </div>
                                  )}

                                  <div
                                    className={`flex flex-col max-w-[85%] sm:max-w-[75%] ${
                                      isCurrentUser ? "items-end" : "items-start"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 mb-1 px-1">
                                      <span className="text-[11px] font-semibold text-text-main">
                                        {isCurrentUser ? "You" : journal.user?.name || "Team Member"}
                                      </span>
                                      <span className="text-[10px] text-text-subtle">
                                        {new Date(journal.created_on).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                    </div>

                                    <div
                                      className={`rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs ${
                                        isCurrentUser
                                          ? "bg-primary/10 border border-primary/25 text-text-main rounded-tr-xs"
                                          : "bg-surface border border-border text-text-main rounded-tl-xs"
                                      }`}
                                    >
                                      {hasNotes && (
                                        <div className="whitespace-pre-wrap font-sans break-words">
                                          {journal.notes}
                                        </div>
                                      )}

                                      {journalAttachments.length > 0 && (
                                        <div className="mt-2.5 pt-2 border-t border-border/40 space-y-2">
                                          {journalAttachments.map((att, attIdx) => {
                                            const isImg = isImageFile(att.filename, att.content_type);
                                            const proxyUrl = getAttachmentProxyUrl(att);

                                            return (
                                              <div key={att.id || attIdx} className="space-y-1">
                                                {isImg ? (
                                                  <div className="relative group/img">
                                                    <img
                                                      src={proxyUrl}
                                                      alt={att.filename}
                                                      className="max-h-60 max-w-full rounded-xl border border-border object-contain bg-black/10 cursor-pointer hover:opacity-95 transition"
                                                      onClick={() => setActiveImagePreview({ url: proxyUrl, name: att.filename })}
                                                      loading="lazy"
                                                    />
                                                    <span className="text-[10px] text-text-subtle block mt-0.5 truncate">
                                                      {att.filename}
                                                    </span>
                                                  </div>
                                                ) : (
                                                  <a
                                                    href={proxyUrl}
                                                    download={att.filename}
                                                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border transition text-[11px] text-text-main"
                                                  >
                                                    <span className="material-symbols-outlined text-[16px] text-primary">
                                                      description
                                                    </span>
                                                    <span className="truncate flex-1 font-medium">{att.filename}</span>
                                                    <span className="material-symbols-outlined text-[14px] text-text-muted">
                                                      download
                                                    </span>
                                                  </a>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {isCurrentUser && (
                                    <div className="size-8 rounded-full bg-primary/15 border border-primary/30 text-primary flex items-center justify-center font-bold text-[11px] shrink-0 shadow-xs">
                                      {getInitials(meta.config?.userName || "Me")}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                      <div ref={chatBottomRef} />
                    </div>
                  </div>

                  {/* Chat Input Bar & Controls */}
                  <div className="border border-border rounded-xl bg-surface p-3.5 shadow-sm space-y-3">
                    {pendingAttachments.length > 0 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1.5 custom-scrollbar">
                        {pendingAttachments.map((item, idx) => (
                          <div
                            key={idx}
                            className="relative flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border text-xs shrink-0 max-w-[220px]"
                          >
                            {item.previewUrl ? (
                              <img
                                src={item.previewUrl}
                                alt={item.name}
                                className="size-8 rounded object-cover border border-border/50 shrink-0"
                              />
                            ) : (
                              <span className="material-symbols-outlined text-[20px] text-primary shrink-0">
                                attach_file
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-medium text-text-main truncate">{item.name}</p>
                              <p className="text-[10px] text-text-muted font-mono">{formatFileSize(item.size)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removePendingAttachment(idx)}
                              className="size-5 rounded-full hover:bg-surface-3 text-text-muted hover:text-text-main flex items-center justify-center shrink-0"
                              aria-label="Remove attachment"
                            >
                              <span className="material-symbols-outlined text-[14px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {chatError && (
                      <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px]">error</span>
                        <span>{chatError}</span>
                      </div>
                    )}

                    <form onSubmit={handleSendChatMessage} className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3 text-xs bg-bg p-2.5 rounded-lg border border-border">
                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] text-text-muted">Status:</label>
                          <select
                            value={chatStatusChange}
                            onChange={(e) => setChatStatusChange(e.target.value)}
                            className="bg-surface border border-border rounded-lg px-2.5 py-1 text-xs text-text-main outline-none focus:border-primary"
                          >
                            {meta.statuses.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                          <label className="text-[11px] text-text-muted whitespace-nowrap">
                            Progress: {chatDoneRatioChange}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="10"
                            value={chatDoneRatioChange ?? 0}
                            onChange={(e) => setChatDoneRatioChange(Number(e.target.value))}
                            className="w-full accent-primary h-1.5 bg-surface-2 rounded-lg cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="relative bg-bg rounded-xl border border-border focus-within:border-primary transition-colors">
                        <textarea
                          rows={3}
                          placeholder="Type a message or press Ctrl+V to paste screenshot / file..."
                          value={chatInputText}
                          onChange={(e) => setChatInputText(e.target.value)}
                          onPaste={handleChatPaste}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              handleSendChatMessage();
                            }
                          }}
                          className="w-full bg-transparent px-3.5 py-2.5 text-xs text-text-main placeholder:text-text-muted outline-none resize-none font-sans"
                        />

                        <div className="flex items-center justify-between px-3 py-2 border-t border-border-subtle bg-surface-2/20">
                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              ref={fileInputRef}
                              multiple
                              onChange={(e) => {
                                if (e.target.files) addFilesToPending(e.target.files);
                                e.target.value = "";
                              }}
                              className="hidden"
                            />

                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface hover:bg-surface-2 text-text-muted hover:text-text-main text-xs border border-border transition min-h-[36px]"
                              title="Attach files or paste from clipboard (Ctrl+V)"
                            >
                              <span className="material-symbols-outlined text-[16px] text-primary">attach_file</span>
                              <span className="text-[11px] font-medium hidden sm:inline">Attach File</span>
                            </button>

                            <span className="text-[10px] text-text-subtle hidden sm:inline">
                              Ctrl+V to paste screenshot
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-text-subtle hidden sm:inline">
                              Ctrl+Enter to send
                            </span>

                            <button
                              type="submit"
                              disabled={
                                sendingChat ||
                                (!chatInputText.trim() &&
                                  pendingAttachments.length === 0 &&
                                  chatStatusChange === String(issueDetail?.status?.id) &&
                                  chatDoneRatioChange === issueDetail?.done_ratio)
                              }
                              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-medium text-xs shadow-sm shadow-primary/20 transition disabled:opacity-40 min-h-[38px]"
                            >
                              {sendingChat ? (
                                <span className="material-symbols-outlined text-[16px] animate-spin">
                                  progress_activity
                                </span>
                              ) : (
                                <span className="material-symbols-outlined text-[16px]">send</span>
                              )}
                              <span>Send</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </form>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL: LOG TIME ──────────────── */}
      {showLogTimeModal && logTimeTargetIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-[14px] w-full max-w-md overflow-hidden shadow-2xl text-text-main">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-2/40">
              <div className="min-w-0 pr-3">
                <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-primary">schedule</span>
                  Log Work Time
                </h3>
                <p className="text-[11px] text-text-muted mt-0.5 truncate">
                  #{logTimeTargetIssue.id}: {logTimeTargetIssue.subject}
                </p>
              </div>
              <button
                onClick={() => setShowLogTimeModal(false)}
                className="text-text-muted hover:text-text-main flex items-center p-1"
                aria-label="Close log time modal"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveLogTime} className="p-5 space-y-4">
              {logTimeMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>{logTimeMsg}</span>
                </div>
              )}

              {logTimeError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{logTimeError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-main mb-1">
                    Hours <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="24"
                    required
                    placeholder="e.g. 2.5"
                    value={logHours}
                    onChange={(e) => setLogHours(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs font-mono text-text-main placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                  />
                  <span className="text-[10px] text-text-subtle mt-1 block">In hours (e.g. 1, 1.5, 2)</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-main mb-1">
                    Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={logSpentOn}
                    onChange={(e) => setLogSpentOn(e.target.value)}
                    className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-main focus:border-primary outline-none transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">
                  Activity <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={logActivityId}
                  onChange={(e) => setLogActivityId(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text-main focus:border-primary outline-none transition-colors"
                >
                  {meta.timeEntryActivities.map((act) => (
                    <option key={act.id} value={String(act.id)}>
                      {act.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">
                  Comments (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Describe what work was accomplished..."
                  value={logComments}
                  onChange={(e) => setLogComments(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text-main placeholder:text-text-muted focus:border-primary outline-none resize-none transition-colors"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowLogTimeModal(false)}
                  className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-medium text-text-main border border-border transition min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLogTime || !logHours || !logActivityId}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
                >
                  {savingLogTime && (
                    <span className="material-symbols-outlined text-[16px] animate-spin">
                      progress_activity
                    </span>
                  )}
                  Save Log Time
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL: IMAGE PREVIEW LIGHTBOX ──────────────── */}
      {activeImagePreview && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setActiveImagePreview(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center bg-surface border border-border rounded-2xl overflow-hidden p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between px-3 py-2 text-xs text-text-muted border-b border-border/40">
              <span className="font-medium truncate max-w-md">{activeImagePreview.name}</span>
              <div className="flex items-center gap-2">
                <a
                  href={activeImagePreview.url}
                  download={activeImagePreview.name}
                  className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main transition flex items-center"
                  title="Download image"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setActiveImagePreview(null)}
                  className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main transition flex items-center"
                  aria-label="Close image preview"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            </div>
            <div className="p-3 overflow-auto max-h-[80vh] flex items-center justify-center">
              <img
                src={activeImagePreview.url}
                alt={activeImagePreview.name}
                className="max-h-full max-w-full rounded-lg object-contain shadow-md"
              />
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL: CONFIGURATION ──────────────── */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-[14px] w-full max-w-md overflow-hidden shadow-2xl text-text-main">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-2/40">
              <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">settings</span>
                Redmine API Configuration
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-text-muted hover:text-text-main flex items-center"
                aria-label="Close config modal"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-5 space-y-4">
              {configMsg && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    configMsg.startsWith("Error")
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] shrink-0">
                    {configMsg.startsWith("Error") ? "error" : "check_circle"}
                  </span>
                  <span>{configMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">Redmine Base URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://redmine.profescipta.co.id"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text-main placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">
                  Redmine API Access Key
                </label>
                <input
                  type="password"
                  required
                  placeholder="Paste your 40-character API access key"
                  value={cfgApiKey}
                  onChange={(e) => setCfgApiKey(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs font-mono text-primary placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                />
                <p className="text-[11px] text-text-muted mt-1">
                  Find your API key on your Redmine account page (`/my/account`).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-main mb-1">Account Email (Optional)</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={cfgEmail}
                  onChange={(e) => setCfgEmail(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text-main placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-medium text-text-main border border-border transition min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition disabled:opacity-50 flex items-center gap-1.5 min-h-[44px]"
                >
                  {savingConfig && (
                    <span className="material-symbols-outlined text-[16px] animate-spin">
                      progress_activity
                    </span>
                  )}
                  Verify & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
