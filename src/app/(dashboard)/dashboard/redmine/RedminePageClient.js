"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

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

  // Edit issue inside modal
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

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

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

      setUpdateSuccessMsg("Issue updated successfully in Redmine.");
      setNoteText("");
      openIssueDetail(selectedIssueId);
      fetchIssues(true);
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      setSavingUpdate(false);
    }
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

    for (const item of issues) {
      const s = (item.status?.name || "").toLowerCase();
      if (s.includes("ready") || s.includes("start")) readyCount++;
      else if (s.includes("progress") || s.includes("doing") || s.includes("dev")) inProgressCount++;
      else if (s.includes("done") || s.includes("close") || s.includes("resolved")) doneCount++;
    }

    return { readyCount, inProgressCount, doneCount };
  }, [issues]);

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
              <h1 className="text-xl sm:text-2xl font-bold text-text-main tracking-tight">Redmine Tasks</h1>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium flex items-center gap-1.5 shadow-xs">
                <span className="size-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                Live Sync
              </span>
            </div>
            <p className="text-xs sm:text-sm text-text-muted mt-0.5 truncate">
              {meta.config?.userName
                ? `Assigned to ${meta.config.userName} (${meta.config.userEmail || "azaky"})`
                : "Active task monitoring and issue management from Profescipta Redmine"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
          <a
            href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/my/page`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-main text-xs font-medium border border-border shadow-xs transition"
          >
            <span className="material-symbols-outlined text-[16px] text-text-muted">open_in_new</span>
            Open Web
          </a>

          <button
            onClick={() => fetchIssues(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-main text-xs font-medium border border-border shadow-xs transition disabled:opacity-50"
            title="Refresh issues"
          >
            <span className={`material-symbols-outlined text-[16px] text-text-muted ${refreshing ? "animate-spin text-primary" : ""}`}>
              refresh
            </span>
            Refresh
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition"
          >
            <span className="material-symbols-outlined text-[16px]">settings</span>
            Config
          </button>
        </div>
      </div>

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
            <span className="text-xs font-medium">Completed / Done</span>
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-text-main">{metrics.doneCount}</div>
          <span className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 block mt-0.5">Closed issues</span>
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
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by Status"
            className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors"
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
            className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors max-w-[220px] truncate"
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
            className="bg-bg border border-border text-text-main rounded-xl px-3 py-2 text-xs outline-none focus:border-primary transition-colors"
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
            className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-200 font-medium text-xs transition shrink-0"
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-main border border-border font-medium text-xs transition"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        /* Table of Issues */
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
                  <th className="px-4 py-3.5 w-28">% Done</th>
                  <th className="px-4 py-3.5">Updated</th>
                  <th className="px-4 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => openIssueDetail(issue.id)}
                    className="hover:bg-surface-2/60 cursor-pointer transition-colors group"
                  >
                    <td className="px-4 py-3.5 font-mono text-xs text-primary font-semibold group-hover:underline">
                      #{issue.id}
                    </td>

                    <td className="px-4 py-3.5 max-w-[220px]">
                      <div className="font-medium text-text-main truncate" title={issue.project?.name}>
                        {issue.project?.name || "General"}
                      </div>
                      <div className="text-[11px] text-text-muted font-mono mt-0.5">
                        {issue.tracker?.name || "Task"}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-md">
                      <div className="font-medium text-text-main truncate" title={issue.subject}>
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
                        <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden border border-border-subtle">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${issue.done_ratio || 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-text-muted font-mono w-8 text-right">
                          {issue.done_ratio || 0}%
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-text-muted text-[11px] whitespace-nowrap">
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
                        className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-main font-medium text-xs transition border border-border inline-flex items-center gap-1 shadow-2xs"
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

      {/* Detail Modal */}
      {selectedIssueId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-[14px] w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-text-main">
            {/* Modal Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-border bg-surface-2/40">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono text-xs font-semibold">
                    #{selectedIssueId}
                  </span>
                  <span className="text-xs text-text-muted font-medium">
                    {issueDetail?.project?.name}
                  </span>
                  <span className="text-text-subtle">•</span>
                  <span className="text-xs text-text-muted">
                    {issueDetail?.tracker?.name}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-text-main leading-snug">
                  {issueDetail?.subject || "Loading task details..."}
                </h3>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`${meta.config?.baseUrl || "https://redmine.profescipta.co.id"}/issues/${selectedIssueId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main border border-border transition flex items-center justify-center"
                  title="Open on Redmine"
                >
                  <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                </a>
                <button
                  onClick={closeIssueDetail}
                  className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-text-muted hover:text-text-main border border-border transition flex items-center justify-center"
                  aria-label="Close detail modal"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {detailLoading ? (
                <div className="space-y-4">
                  <div className="h-20 rounded-xl bg-surface-2 animate-pulse" />
                  <div className="h-40 rounded-xl bg-surface-2 animate-pulse" />
                </div>
              ) : detailError ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">error</span>
                  <span>{detailError}</span>
                </div>
              ) : issueDetail ? (
                <>
                  {/* Meta Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-bg p-3.5 rounded-xl border border-border text-xs">
                    <div>
                      <span className="text-text-muted block text-[11px]">Status</span>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium border ${getStatusBadgeClass(
                          issueDetail.status?.name
                        )}`}
                      >
                        {issueDetail.status?.name}
                      </span>
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
                      <span className="text-text-muted block text-[11px]">Author</span>
                      <span className="font-medium text-text-main block mt-1">
                        {issueDetail.author?.name || "-"}
                      </span>
                    </div>

                    <div>
                      <span className="text-text-muted block text-[11px]">Assigned To</span>
                      <span className="font-medium text-text-main block mt-1">
                        {issueDetail.assigned_to?.name || "-"}
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                      Description
                    </h4>
                    <div className="bg-bg border border-border rounded-xl p-4 text-xs text-text-main leading-relaxed whitespace-pre-wrap font-sans">
                      {issueDetail.description || "(No description provided)"}
                    </div>
                  </div>

                  {/* Journals / Comment History */}
                  {Array.isArray(issueDetail.journals) && issueDetail.journals.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                        History & Comments ({issueDetail.journals.length})
                      </h4>
                      <div className="space-y-3">
                        {issueDetail.journals.map((journal) => (
                          <div
                            key={journal.id}
                            className="bg-bg border border-border rounded-xl p-3.5 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-text-muted text-[11px]">
                              <span className="font-medium text-text-main">
                                {journal.user?.name || "System"}
                              </span>
                              <span>{new Date(journal.created_on).toLocaleString()}</span>
                            </div>

                            {Array.isArray(journal.details) && journal.details.length > 0 && (
                              <ul className="text-[11px] text-text-muted space-y-0.5 pl-4 list-disc">
                                {journal.details.map((d, dIdx) => (
                                  <li key={dIdx}>
                                    <span className="text-text-main font-medium">{d.name}</span> changed from{" "}
                                    <span className="text-text-muted line-through">{d.old_value || "(none)"}</span> to{" "}
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">{d.new_value || "(none)"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {journal.notes && (
                              <p className="text-text-main leading-relaxed whitespace-pre-wrap pt-1 font-sans">
                                {journal.notes}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Update Issue Section */}
                  <div className="border-t border-border pt-4">
                    <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                      Update Task & Add Note
                    </h4>

                    {updateSuccessMsg && (
                      <div className="mb-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">check_circle</span>
                        <span>{updateSuccessMsg}</span>
                      </div>
                    )}

                    <form onSubmit={handleUpdateIssue} className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-text-muted text-[11px] mb-1">Status</label>
                          <select
                            value={editStatusId}
                            onChange={(e) => setEditStatusId(e.target.value)}
                            className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-main outline-none focus:border-primary transition-colors"
                          >
                            {meta.statuses.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-text-muted text-[11px] mb-1">
                            Progress: {editDoneRatio}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="10"
                            value={editDoneRatio}
                            onChange={(e) => setEditDoneRatio(Number(e.target.value))}
                            className="w-full accent-primary h-2 bg-surface-2 rounded-lg cursor-pointer mt-2"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-text-muted text-[11px] mb-1">Notes / Comment</label>
                        <textarea
                          rows={3}
                          placeholder="Add comments or implementation progress notes..."
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          className="w-full bg-bg border border-border rounded-xl px-3 py-2 text-xs text-text-main placeholder:text-text-muted outline-none focus:border-primary resize-none font-sans transition-colors"
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={savingUpdate}
                          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white font-medium text-xs shadow-sm shadow-primary/20 transition disabled:opacity-50 flex items-center gap-1.5"
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
                  placeholder="arfan.zaky@dipstrategy.co.id"
                  value={cfgEmail}
                  onChange={(e) => setCfgEmail(e.target.value)}
                  className="w-full bg-bg border border-border rounded-xl px-3.5 py-2 text-xs text-text-main placeholder:text-text-muted focus:border-primary outline-none transition-colors"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-medium text-text-main border border-border transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-medium shadow-sm shadow-primary/20 transition disabled:opacity-50 flex items-center gap-1.5"
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
