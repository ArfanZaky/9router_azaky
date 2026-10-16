import fs from "node:fs";
import path from "node:path";
import { getSettings, updateSettings, listChatSessions } from "@/lib/localDb";
import { sortIssuesByDueDate } from "./sortIssuesByDueDate";

export const DEFAULT_REDMINE_CONFIG = {
  baseUrl: "https://redmine.profescipta.co.id",
  apiKey: "",
  userEmail: "",
  userId: null,
  userName: "",
  projectPaths: {},
  autoWorkWithAi: false,
  aiModel: "anthropic/claude-3-7-sonnet",
};

export async function getRedmineConfig() {
  const settings = await getSettings();
  const stored = settings?.redmine || {};
  return {
    baseUrl: (stored.baseUrl || DEFAULT_REDMINE_CONFIG.baseUrl).replace(/\/+$/, ""),
    apiKey: stored.apiKey || DEFAULT_REDMINE_CONFIG.apiKey,
    userEmail: stored.userEmail || DEFAULT_REDMINE_CONFIG.userEmail,
    userId: stored.userId || DEFAULT_REDMINE_CONFIG.userId,
    userName: stored.userName || DEFAULT_REDMINE_CONFIG.userName,
    projectPaths: stored.projectPaths || {},
    autoWorkWithAi: stored.autoWorkWithAi === true,
    aiModel: stored.aiModel || DEFAULT_REDMINE_CONFIG.aiModel,
  };
}

export async function saveRedmineConfig(updates = {}) {
  const current = await getRedmineConfig();
  const next = {
    ...current,
    ...updates,
    baseUrl: (updates.baseUrl || current.baseUrl).replace(/\/+$/, ""),
    autoWorkWithAi: updates.autoWorkWithAi !== undefined ? Boolean(updates.autoWorkWithAi) : current.autoWorkWithAi,
    aiModel: updates.aiModel ? String(updates.aiModel).trim() : current.aiModel,
  };
  await updateSettings({ redmine: next });
  return next;
}

function getHeaders(apiKey) {
  return {
    "X-Redmine-API-Key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function inspectLocalPath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") {
    return { exists: false, isDir: false, isGit: false, path: "" };
  }
  try {
    const normalized = path.normalize(targetPath.trim());
    if (!fs.existsSync(normalized)) {
      return { exists: false, isDir: false, isGit: false, path: normalized };
    }
    const stat = fs.statSync(normalized);
    const isDir = stat.isDirectory();
    const isGit = isDir && (fs.existsSync(path.join(normalized, ".git")) || fs.existsSync(path.join(normalized, ".gitmodules")));
    return { exists: true, isDir, isGit, path: normalized };
  } catch {
    return { exists: false, isDir: false, isGit: false, path: targetPath };
  }
}

export async function assignRedmineProjectPath(projectId, localPath, autoWork = undefined) {
  const current = await getRedmineConfig();
  const projectPaths = { ...(current.projectPaths || {}) };
  const pid = String(projectId);
  const existing = projectPaths[pid] || {};

  const cleanPath = localPath !== undefined ? String(localPath || "").trim() : undefined;

  if (cleanPath === "" && autoWork === undefined) {
    delete projectPaths[pid];
  } else {
    const finalPath = cleanPath !== undefined ? cleanPath : (existing.path || "");
    const finalAutoWork = autoWork !== undefined
      ? Boolean(autoWork)
      : (existing.autoWork !== undefined ? Boolean(existing.autoWork) : true);

    if (!finalPath && autoWork === undefined) {
      delete projectPaths[pid];
    } else {
      projectPaths[pid] = {
        path: finalPath,
        assignedAt: existing.assignedAt || new Date().toISOString(),
        autoWork: finalAutoWork,
      };
    }
  }
  await saveRedmineConfig({ projectPaths });
  return projectPaths;
}

export async function removeRedmineProjectPath(projectId) {
  const current = await getRedmineConfig();
  const projectPaths = { ...(current.projectPaths || {}) };
  delete projectPaths[String(projectId)];
  await saveRedmineConfig({ projectPaths });
  return projectPaths;
}

export async function getKnownWorkspaces() {
  const pathsSet = new Set();
  const results = [];

  // 1. Scan chat sessions
  try {
    const sessions = await listChatSessions({ limit: 100 });
    for (const s of sessions || []) {
      const p = s.workspacePath || s.codebase;
      if (p && typeof p === "string" && !pathsSet.has(p)) {
        pathsSet.add(p);
      }
    }
  } catch {
    // Ignore error if sessions table query fails
  }

  // 2. Scan common development roots
  const rootsToScan = ["F:\\project", "C:\\project", process.cwd()];
  for (const root of rootsToScan) {
    try {
      if (fs.existsSync(root)) {
        pathsSet.add(path.normalize(root));
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            pathsSet.add(path.join(root, entry.name));
          }
        }
      }
    } catch {
      // Ignore directory access error
    }
  }

  for (const p of pathsSet) {
    const inspection = inspectLocalPath(p);
    results.push({
      path: p,
      name: path.basename(p) || p,
      exists: inspection.exists,
      isDir: inspection.isDir,
      isGit: inspection.isGit,
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function verifyRedmineConnection(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  const res = await fetch(`${config.baseUrl}/users/current.json`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Redmine auth failed (${res.status}): ${errorText || res.statusText}`);
  }
  const data = await res.json();
  return data?.user || null;
}

export async function getUserAssignedProjectStats(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return new Map();

  const stats = new Map(); // projectId -> { count, openCount }
  try {
    const res = await fetch(
      `${config.baseUrl}/issues.json?assigned_to_id=me&status_id=*&limit=100`,
      {
        headers: getHeaders(config.apiKey),
        cache: "no-store",
      }
    );
    if (res.ok) {
      const data = await res.json();
      const issues = data?.issues || [];
      for (const issue of issues) {
        if (issue.project?.id) {
          const pid = Number(issue.project.id);
          const curr = stats.get(pid) || { count: 0, openCount: 0 };
          curr.count++;
          const s = (issue.status?.name || "").toLowerCase();
          if (
            !s.includes("done") &&
            !s.includes("close") &&
            !s.includes("resolved") &&
            !s.includes("reject") &&
            !s.includes("cancel")
          ) {
            curr.openCount++;
          }
          stats.set(pid, curr);
        }
      }
    }
  } catch {
    // quiet fallback
  }
  return stats;
}

export async function getRedmineIssues({
  statusId = "open",
  assignedToId = "me",
  projectId = "",
  trackerId = "",
  limit = 50,
  offset = 0,
  sort = "updated_on:desc",
  search = "",
  customConfig = null,
} = {}) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  const params = new URLSearchParams();
  if (assignedToId) params.append("assigned_to_id", assignedToId);
  if (statusId) params.append("status_id", statusId);
  if (projectId) params.append("project_id", projectId);
  if (trackerId) params.append("tracker_id", trackerId);
  params.append("limit", String(Math.min(limit, 100)));
  params.append("offset", String(offset));
  params.append("sort", sort);

  // The dashboard has no pagination control. Read every page when sorting by due date
  // so tickets with a due date cannot be hidden behind Redmine's undated tickets.
  const sortByDueDate = sort === "due_date:asc";
  let issues = [];
  let totalCount = 0;
  do {
    const url = `${config.baseUrl}/issues.json?${params.toString()}`;
    const res = await fetch(url, {
      headers: getHeaders(config.apiKey),
      cache: "no-store",
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch issues (${res.status}): ${errorText || res.statusText}`);
    }

    const data = await res.json();
    const page = data?.issues || [];
    issues.push(...page);
    totalCount = data?.total_count ?? issues.length;
    if (!sortByDueDate || page.length === 0) break;
    params.set("offset", String(offset + issues.length));
  } while (offset + issues.length < totalCount);

  if (sortByDueDate) issues = sortIssuesByDueDate(issues);

  if (search && search.trim()) {
    const term = search.toLowerCase().trim();
    issues = issues.filter((i) =>
      (i.subject && i.subject.toLowerCase().includes(term)) ||
      (i.project?.name && i.project.name.toLowerCase().includes(term)) ||
      (i.tracker?.name && i.tracker.name.toLowerCase().includes(term)) ||
      (i.status?.name && i.status.name.toLowerCase().includes(term)) ||
      String(i.id).includes(term)
    );
    totalCount = issues.length;
  }

  // Keep the existing dashboard row limit after selecting the earliest due dates.
  if (sortByDueDate) issues = issues.slice(0, limit);

  const projectPaths = config.projectPaths || {};
  let localTaskStatuses = {};
  try {
    const settings = await getSettings();
    localTaskStatuses = settings?.redmineTaskStatuses || {};
  } catch {
    // ignore
  }

  let existingSessionIds = new Set();
  try {
    const allSessions = await listChatSessions({ limit: 500 });
    existingSessionIds = new Set((allSessions || []).map((s) => s.id));
  } catch {
    // ignore
  }

  issues = issues.map((i) => {
    const pid = String(i.project?.id || "");
    const pident = String(i.project?.identifier || "");
    const assigned = projectPaths[pid] || projectPaths[pident] || null;
    const localPath = assigned?.path || null;
    const projectAutoWork = assigned ? (assigned.autoWork !== undefined ? Boolean(assigned.autoWork) : true) : false;
    const localTask = localTaskStatuses[String(i.id)] || null;

    let validSessionId = localTask?.sessionId || null;
    let localStatus = localTask?.status || null;
    if (validSessionId && !existingSessionIds.has(validSessionId)) {
      validSessionId = null;
      if (localStatus === "working") {
        localStatus = null;
      }
    }

    return {
      ...i,
      localPath,
      projectAutoWork,
      localStatus,
      localStatusReason: localTask?.reason || null,
      localSessionId: validSessionId,
      localSessionTitle: validSessionId ? localTask?.sessionTitle || null : null,
    };
  });

  return {
    issues,
    totalCount,
    limit,
    offset,
  };
}

export async function getRedmineIssueDetail(issueId, customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  const url = `${config.baseUrl}/issues/${issueId}.json?include=journals,attachments,relations,children,watchers`;
  const res = await fetch(url, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch issue #${issueId} (${res.status}): ${errorText || res.statusText}`);
  }
  const data = await res.json();
  return data?.issue || null;
}

export async function updateRedmineIssue(issueId, { notes, statusId, doneRatio, assignedToId, uploads }, customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  const issueUpdate = {};
  if (notes) issueUpdate.notes = notes;
  if (statusId) issueUpdate.status_id = Number(statusId);
  if (doneRatio !== undefined && doneRatio !== null) issueUpdate.done_ratio = Number(doneRatio);
  if (assignedToId !== undefined) {
    if (assignedToId === null || assignedToId === "") {
      issueUpdate.assigned_to_id = "";
    } else if (/^[1-9]\d*$/.test(String(assignedToId))) {
      issueUpdate.assigned_to_id = Number(assignedToId);
    } else {
      throw new Error("Invalid assignedToId");
    }
  }
  if (Array.isArray(uploads) && uploads.length > 0) issueUpdate.uploads = uploads;

  const res = await fetch(`${config.baseUrl}/issues/${issueId}.json`, {
    method: "PUT",
    headers: getHeaders(config.apiKey),
    body: JSON.stringify({ issue: issueUpdate }),
  });

  if (!res.ok && res.status !== 204) {
    const errorText = await res.text();
    throw new Error(`Failed to update issue #${issueId} (${res.status}): ${errorText || res.statusText}`);
  }
  return { ok: true, issueId };
}

export async function getRedmineProjects(customConfig = null, { all = true, search = "", relevantOnly = true } = {}) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  
  const allProjects = [];
  const limit = 100;
  let offset = 0;
  let totalCount = 0;

  const [_, userTaskStats] = await Promise.all([
    (async () => {
      do {
        const res = await fetch(`${config.baseUrl}/projects.json?limit=${limit}&offset=${offset}`, {
          headers: getHeaders(config.apiKey),
          cache: "no-store",
        });
        if (!res.ok) break;
        const data = await res.json();
        totalCount = data?.total_count || 0;
        const batch = data?.projects || [];
        allProjects.push(...batch);
        if (!all || allProjects.length >= totalCount || batch.length === 0) break;
        offset += limit;
      } while (offset < totalCount);
    })(),
    getUserAssignedProjectStats(config).catch(() => new Map()),
  ]);

  const projectPaths = config.projectPaths || {};
  let enriched = allProjects.map((p) => {
    const assigned = projectPaths[String(p.id)] || projectPaths[String(p.identifier)];
    const localPath = assigned?.path || null;
    const assignedAt = assigned?.assignedAt || null;
    const autoWork = assigned ? (assigned.autoWork !== undefined ? Boolean(assigned.autoWork) : true) : false;
    const inspection = localPath ? inspectLocalPath(localPath) : null;
    const taskInfo = userTaskStats.get(Number(p.id)) || userTaskStats.get(String(p.id)) || { count: 0, openCount: 0 };
    const hasUserTasks = taskInfo.count > 0;
    const hasAssignedPath = Boolean(localPath);
    const isRelevant = hasUserTasks || hasAssignedPath;

    return {
      ...p,
      localPath,
      assignedAt,
      autoWork,
      pathExists: inspection?.exists ?? null,
      isGitRepo: inspection?.isGit ?? null,
      userTasksCount: taskInfo.count,
      openTasksCount: taskInfo.openCount,
      hasUserTasks,
      hasAssignedPath,
      isRelevant,
    };
  });

  if (relevantOnly) {
    enriched = enriched.filter((p) => p.isRelevant);
  }

  if (search && search.trim()) {
    const term = search.toLowerCase().trim();
    enriched = enriched.filter((p) =>
      (p.name && p.name.toLowerCase().includes(term)) ||
      (p.identifier && p.identifier.toLowerCase().includes(term)) ||
      (p.description && p.description.toLowerCase().includes(term)) ||
      (p.localPath && p.localPath.toLowerCase().includes(term))
    );
  }

  // Sort: open tasks desc, then assigned path desc, then name asc
  enriched.sort((a, b) => {
    if ((b.openTasksCount || 0) !== (a.openTasksCount || 0)) {
      return (b.openTasksCount || 0) - (a.openTasksCount || 0);
    }
    if (Boolean(b.localPath) !== Boolean(a.localPath)) {
      return b.localPath ? 1 : -1;
    }
    return (a.name || "").localeCompare(b.name || "");
  });

  return enriched;
}

export async function getRedmineProjectAssignees(projectId, customConfig = null) {
  if (!/^[1-9]\d*$/.test(String(projectId))) throw new Error("Invalid project ID");
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) throw new Error("Redmine API key is not configured");

  const assignees = new Map();
  const limit = 100;
  let offset = 0;
  let total = 0;
  do {
    const url = `${config.baseUrl}/projects/${projectId}/memberships.json?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: getHeaders(config.apiKey), cache: "no-store" });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch project members (${res.status}): ${errorText || res.statusText}`);
    }
    const data = await res.json();
    const memberships = data?.memberships || [];
    total = data?.total_count ?? memberships.length;
    for (const membership of memberships) {
      const assignee = membership.user || membership.group;
      if (assignee?.id && assignee?.name) {
        assignees.set(String(assignee.id), {
          id: assignee.id,
          name: assignee.name,
          type: membership.group ? "group" : "user",
        });
      }
    }
    offset += memberships.length;
    if (memberships.length === 0) break;
  } while (offset < total);

  return [...assignees.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export async function getRedmineStatuses(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const res = await fetch(`${config.baseUrl}/issue_statuses.json`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.issue_statuses || [];
}

export async function getRedmineTrackers(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const res = await fetch(`${config.baseUrl}/trackers.json`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.trackers || [];
}

export async function getRedminePriorities(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const res = await fetch(`${config.baseUrl}/enumerations/issue_priorities.json`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.issue_priorities || [];
}

export async function getTimeEntryActivities(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const res = await fetch(`${config.baseUrl}/enumerations/time_entry_activities.json`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.time_entry_activities || [];
}

export async function getTimeEntries({ issueId = null, userId = null, limit = 50, offset = 0, customConfig = null } = {}) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const params = new URLSearchParams();
  if (issueId) params.append("issue_id", String(issueId));
  if (userId) params.append("user_id", String(userId));
  params.append("limit", String(limit));
  params.append("offset", String(offset));

  const res = await fetch(`${config.baseUrl}/time_entries.json?${params.toString()}`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.time_entries || [];
}

export async function createRedmineTimeEntry({ issueId, hours, activityId, comments = "", spentOn = null }, customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  if (!issueId || !hours || !activityId) {
    throw new Error("issueId, hours, and activityId are required to log time");
  }

  const payload = {
    time_entry: {
      issue_id: Number(issueId),
      hours: Number(hours),
      activity_id: Number(activityId),
      comments: String(comments || "").trim(),
      spent_on: spentOn || new Date().toISOString().slice(0, 10),
    },
  };

  const res = await fetch(`${config.baseUrl}/time_entries.json`, {
    method: "POST",
    headers: getHeaders(config.apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.status !== 201) {
    const errorText = await res.text();
    throw new Error(`Failed to log time (${res.status}): ${errorText || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  return data?.time_entry || { ok: true };
}

export async function uploadRedmineFile({ buffer, filename, contentType = "application/octet-stream" }, customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }

  const res = await fetch(`${config.baseUrl}/uploads.json?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: {
      "X-Redmine-API-Key": config.apiKey,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  if (!res.ok && res.status !== 201) {
    const errorText = await res.text();
    throw new Error(`Failed to upload attachment to Redmine (${res.status}): ${errorText || res.statusText}`);
  }

  const data = await res.json();
  return {
    token: data?.upload?.token,
    id: data?.upload?.id,
    filename,
    contentType,
  };
}
