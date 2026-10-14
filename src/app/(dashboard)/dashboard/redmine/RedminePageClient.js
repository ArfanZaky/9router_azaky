"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

function getStatusBadgeClass(statusName = "") {
  const s = statusName.toLowerCase();
  if (s.includes("done") || s.includes("close") || s.includes("resolved")) {
    return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  }
  if (s.includes("progress") || s.includes("doing") || s.includes("on-progress")) {
    return "bg-amber-500/10 text-amber-500 border-amber-500/20";
  }
  if (s.includes("ready") || s.includes("start")) {
    return "bg-sky-500/10 text-sky-500 border-sky-500/20";
  }
  if (s.includes("qa") || s.includes("review") || s.includes("test")) {
    return "bg-purple-500/10 text-purple-500 border-purple-500/20";
  }
  if (s.includes("cancel") || s.includes("reject")) {
    return "bg-rose-500/10 text-rose-500 border-rose-500/20";
  }
  return "bg-slate-500/10 text-slate-400 border-slate-500/20";
}

function getPriorityBadgeClass(priorityName = "") {
  const p = priorityName.toLowerCase();
  if (p.includes("urgent") || p.includes("immediate") || p.includes("high")) {
    return "bg-rose-500/10 text-rose-500 border-rose-500/20";
  }
  if (p.includes("low")) {
    return "bg-slate-500/10 text-slate-400 border-slate-500/20";
  }
  return "bg-slate-800/80 text-slate-300 border-slate-700/50";
}

export default function RedminePageClient() {
  const [issues, setIssues] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [meta, setMeta] = useState({
    projects: [],
    statuses: [],
    trackers: [],
    config: null,
  });

  const [statusFilter, setStatusFilter] = useState("open");
  const [projectFilter, setProjectFilter] = useState("");
  const [trackerFilter, setTrackerFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedIssueId, setSelectedIssueId] = useState(null);
  const [issueDetail, setIssueDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  // Edit / update issue state inside modal
  const [noteText, setNoteText] = useState("");
  const [editStatusId, setEditStatusId] = useState("");
  const [editDoneRatio, setEditDoneRatio] = useState(0);
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [updateSuccessMsg, setUpdateSuccessMsg] = useState("");

  // Config modal
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cfgBaseUrl, setCfgBaseUrl] = useState("https://redmine.profescipta.co.id");
  const [cfgApiKey, setCfgApiKey] = useState("");
  const [cfgEmail, setCfgEmail] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  // Load metadata (projects, statuses, trackers, user)
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
      // metadata load failure handled quietly
    }
  }, []);

  // Fetch issues
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

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Load issue detail
  const openIssueDetail = async (id) => {
    setSelectedIssueId(id);
    setDetailLoading(true);
    setDetailError("");
    setNoteText("");
    setUpdateSuccessMsg("");

    try {
      const res = await fetch(`/api/redmine/issues/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load issue details");
      setIssueDetail(data);
      setEditStatusId(String(data.status?.id || ""));
      setEditDoneRatio(data.done_ratio || 0);
    } catch (err) {
      setDetailError(err.message || "Failed to load issue details");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeIssueDetail = () => {
    setSelectedIssueId(null);
    setIssueDetail(null);
    setDetailError("");
    setUpdateSuccessMsg("");
  };

  // Submit update for an issue
  const handleUpdateIssue = async (e) => {
    e.preventDefault();
    if (!selectedIssueId) return;
    setSavingUpdate(true);
    setUpdateSuccessMsg("");

    try {
      const body = {
        statusId: editStatusId ? Number(editStatusId) : undefined,
        doneRatio: Number(editDoneRatio),
        notes: noteText.trim() || undefined,
      };

      const res = await fetch(`/api/redmine/issues/${selectedIssueId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update issue in Redmine");

      setUpdateSuccessMsg("Issue updated successfully in Redmine!");
      setNoteText("");
      // Refresh current issue detail and overall list
      openIssueDetail(selectedIssueId);
      fetchIssues(true);
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSavingUpdate(false);
    }
  };

  // Save config
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

      setConfigMsg("Redmine connection verified and saved!");
      loadMeta();
      fetchIssues(true);
      setTimeout(() => setShowConfigModal(false), 1200);
    } catch (err) {
      setConfigMsg(`Error: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  };

  // Metric summaries
  const metrics = useMemo(() => {
    let readyCount = 0;
    let inProgressCount = 0;
    let doneCount = 0;

    for (const item of issues) {
      const s = (item.status?.name || "").toLowerCase();
      if (s.includes("ready") || s.includes("start")) readyCount++;
      else if (s.includes("progress") || s.includes("doing") || s.includes("dev")) inProgressCount++;
      else if (s.includes("done") || s.includes("close") || s.includes("resolved")) doneCount++;
    }

    return { readyCount, inProgressCount, doneCount };
  }, [issues]);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/40 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center">
            <span className="material-symbols-outlined text-[22px]">task_alt</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-white">Redmine Tasks</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {meta.config?.userName
                ? `Assigned to ${meta.config.userName} (${meta.config.userEmail || "azaky"})`
                : "Active task monitoring and management from Profescipta Redmine"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/my/page`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            Open Web
          </a>

          <button
            onClick={() => fetchIssues(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-medium border border-slate-700/60 transition disabled:opacity-50"
            title="Refresh issues"
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? "animate-spin" : ""}`}>
              refresh
            </span>
            Refresh
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-300 hover:text-white text-xs font-medium border border-red-500/30 transition"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            Config
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* Metric Cards */}
        <section aria-label="Task Summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-medium">Total Assigned</span>
              <span className="material-symbols-outlined text-[18px] text-slate-500">assignment</span>
            </div>
            <div className="text-2xl font-bold text-white">{totalCount}</div>
            <span className="text-[11px] text-slate-500">Current filter scope</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center justify-between text-sky-400 mb-1">
              <span className="text-xs font-medium">Ready To Start</span>
              <span className="material-symbols-outlined text-[18px]">play_circle</span>
            </div>
            <div className="text-2xl font-bold text-white">{metrics.readyCount}</div>
            <span className="text-[11px] text-sky-400/70">Awaiting development</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center justify-between text-amber-400 mb-1">
              <span className="text-xs font-medium">In Progress</span>
              <span className="material-symbols-outlined text-[18px]">engineering</span>
            </div>
            <div className="text-2xl font-bold text-white">{metrics.inProgressCount}</div>
            <span className="text-[11px] text-amber-400/70">Active work items</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4">
            <div className="flex items-center justify-between text-emerald-400 mb-1">
              <span className="text-xs font-medium">Completed / Done</span>
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
            </div>
            <div className="text-2xl font-bold text-white">{metrics.doneCount}</div>
            <span className="text-[11px] text-emerald-400/70">Closed issues</span>
          </div>
        </section>

        {/* Filter and Search Bar */}
        <section aria-label="Filters" className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="flex-1 flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 max-w-md">
            <span className="material-symbols-outlined text-[18px] text-slate-500">search</span>
            <input
              type="text"
              placeholder="Search by subject, issue ID, or project..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-xs text-white placeholder-slate-500 flex-1"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-slate-500 hover:text-slate-300">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by Status"
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-red-500/50"
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

            {/* Project Filter */}
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by Project"
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-red-500/50 max-w-[200px] truncate"
            >
              <option value="">All Projects</option>
              {meta.projects.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* Tracker Filter */}
            <select
              value={trackerFilter}
              onChange={(e) => setTrackerFilter(e.target.value)}
              aria-label="Filter by Tracker"
              className="bg-slate-950 border border-slate-800 text-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-red-500/50"
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
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] shrink-0">error</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchIssues(true)}
              className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium text-xs transition shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-16 rounded-2xl bg-slate-900/40 border border-slate-800/60 animate-pulse" />
            ))}
          </div>
        ) : issues.length === 0 ? (
          /* Empty State */
          <div className="text-center py-16 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
            <span className="material-symbols-outlined text-[48px] text-slate-600 mx-auto mb-3 block">
              task
            </span>
            <h3 className="text-sm font-semibold text-slate-300">No Redmine Tasks Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
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
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          /* Table of Issues */
          <div className="border border-slate-800/80 rounded-2xl overflow-hidden bg-slate-900/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3 font-medium w-20"># ID</th>
                    <th className="px-4 py-3 font-medium">Tracker & Project</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Priority</th>
                    <th className="px-4 py-3 font-medium w-28">% Done</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {issues.map((issue) => (
                    <tr
                      key={issue.id}
                      onClick={() => openIssueDetail(issue.id)}
                      className="hover:bg-slate-800/30 cursor-pointer transition"
                    >
                      <td className="px-4 py-3.5 font-mono text-[11px] text-red-400 font-semibold">
                        #{issue.id}
                      </td>

                      <td className="px-4 py-3.5 max-w-[220px]">
                        <div className="font-medium text-slate-200 truncate" title={issue.project?.name}>
                          {issue.project?.name || "General"}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {issue.tracker?.name || "Task"}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 max-w-md">
                        <div className="font-medium text-white truncate" title={issue.subject}>
                          {issue.subject}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeClass(
                            issue.status?.name
                          )}`}
                        >
                          {issue.status?.name || "Open"}
                        </span>
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

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-red-500 rounded-full transition-all"
                              style={{ width: `${issue.done_ratio || 0}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono w-7 text-right">
                            {issue.done_ratio || 0}%
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-slate-400 text-[11px] whitespace-nowrap">
                        {issue.updated_on
                          ? new Date(issue.updated_on).toLocaleDateString()
                          : "-"}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openIssueDetail(issue.id);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium text-xs transition border border-slate-700/60 inline-flex items-center gap-1"
                        >
                          Detail
                          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Detail Modal / Slide-over */}
      {selectedIssueId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-xs font-semibold">
                    #{selectedIssueId}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {issueDetail?.project?.name}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="text-xs text-slate-400">
                    {issueDetail?.tracker?.name}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-white leading-snug">
                  {issueDetail?.subject || "Loading task details..."}
                </h3>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/issues/${selectedIssueId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition flex items-center justify-center"
                  title="Open on Redmine"
                >
                  <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                </a>
                <button
                  onClick={closeIssueDetail}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {detailLoading ? (
                <div className="space-y-4">
                  <div className="h-20 rounded-xl bg-slate-800/40 animate-pulse" />
                  <div className="h-40 rounded-xl bg-slate-800/40 animate-pulse" />
                </div>
              ) : detailError ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{detailError}</span>
                </div>
              ) : issueDetail ? (
                <>
                  {/* Meta Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Status</span>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusBadgeClass(
                          issueDetail.status?.name
                        )}`}
                      >
                        {issueDetail.status?.name}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Priority</span>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium border ${getPriorityBadgeClass(
                          issueDetail.priority?.name
                        )}`}
                      >
                        {issueDetail.priority?.name}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Author</span>
                      <span className="font-medium text-slate-300 block mt-1">
                        {issueDetail.author?.name || "-"}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Assigned To</span>
                      <span className="font-medium text-slate-300 block mt-1">
                        {issueDetail.assigned_to?.name || "-"}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                      Description
                    </h4>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                      {issueDetail.description || "(No description provided)"}
                    </div>
                  </div>

                  {/* Journals / Comment History */}
                  {Array.isArray(issueDetail.journals) && issueDetail.journals.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                        History & Comments ({issueDetail.journals.length})
                      </h4>
                      <div className="space-y-3">
                        {issueDetail.journals.map((journal) => (
                          <div
                            key={journal.id}
                            className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-slate-400 text-[11px]">
                              <span className="font-medium text-slate-300">
                                {journal.user?.name || "System"}
                              </span>
                              <span>{new Date(journal.created_on).toLocaleString()}</span>
                            </div>

                            {Array.isArray(journal.details) && journal.details.length > 0 && (
                              <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
                                {journal.details.map((d, dIdx) => (
                                  <li key={dIdx}>
                                    <span className="text-slate-300 font-medium">{d.name}</span> changed from{" "}
                                    <span className="text-slate-400 line-through">{d.old_value || "(none)"}</span> to{" "}
                                    <span className="text-emerald-400 font-medium">{d.new_value || "(none)"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {journal.notes && (
                              <p className="text-slate-200 leading-relaxed whitespace-pre-wrap pt-1 font-sans">
                                {journal.notes}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Update Issue Section */}
                  <div className="border-t border-slate-800 pt-4">
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
                      Update Task & Add Note
                    </h4>

                    {updateSuccessMsg && (
                      <div className="mb-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        <span>{updateSuccessMsg}</span>
                      </div>
                    )}

                    <form onSubmit={handleUpdateIssue} className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-slate-400 text-[11px] mb-1">Status</label>
                          <select
                            value={editStatusId}
                            onChange={(e) => setEditStatusId(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-red-500"
                          >
                            {meta.statuses.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-slate-400 text-[11px] mb-1">
                            Progress: {editDoneRatio}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="10"
                            value={editDoneRatio}
                            onChange={(e) => setEditDoneRatio(Number(e.target.value))}
                            className="w-full accent-red-500 h-2 bg-slate-800 rounded-lg cursor-pointer mt-2"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-slate-400 text-[11px] mb-1">Notes / Comment</label>
                        <textarea
                          rows={3}
                          placeholder="Add comments or implementation progress notes..."
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-red-500 resize-none font-sans"
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={savingUpdate}
                          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-medium text-xs transition disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {savingUpdate && (
                            <span className="material-symbols-outlined text-[16px] animate-spin">
                              progress_activity
                            </span>
                          )}
                          Save Changes to Redmine
                        </button>
                      </div>
                    </form>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-red-400">settings</span>
                Redmine API Configuration
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white flex items-center"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-5 space-y-4">
              {configMsg && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                    configMsg.startsWith("Error")
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px] shrink-0">
                    {configMsg.startsWith("Error") ? "error" : "check_circle"}
                  </span>
                  <span>{configMsg}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Redmine Base URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://redmine.profescipta.co.id"
                  value={cfgBaseUrl}
                  onChange={(e) => setCfgBaseUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Redmine API Access Key
                </label>
                <input
                  type="password"
                  required
                  placeholder="Paste your 40-character API access key"
                  value={cfgApiKey}
                  onChange={(e) => setCfgApiKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-mono text-red-300 placeholder-slate-600 focus:border-red-500 outline-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Find your API key on your Redmine account page (`/my/account`).
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Account Email (Optional)</label>
                <input
                  type="email"
                  placeholder="arfan.zaky@dipstrategy.co.id"
                  value={cfgEmail}
                  onChange={(e) => setCfgEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-600 focus:border-red-500 outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition disabled:opacity-50 flex items-center gap-1.5"
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
