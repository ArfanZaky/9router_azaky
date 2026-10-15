import { getSettings, updateSettings } from "@/lib/localDb";

export const DEFAULT_REDMINE_CONFIG = {
  baseUrl: "https://redmine.profescipta.co.id",
  apiKey: "",
  userEmail: "",
  userId: null,
  userName: "",
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
  };
}

export async function saveRedmineConfig(updates = {}) {
  const current = await getRedmineConfig();
  const next = {
    ...current,
    ...updates,
    baseUrl: (updates.baseUrl || current.baseUrl).replace(/\/+$/, ""),
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
  let issues = data?.issues || [];
  let totalCount = data?.total_count ?? issues.length;

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

export async function updateRedmineIssue(issueId, { notes, statusId, doneRatio, uploads }, customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) {
    throw new Error("Redmine API key is not configured");
  }
  const issueUpdate = {};
  if (notes) issueUpdate.notes = notes;
  if (statusId) issueUpdate.status_id = Number(statusId);
  if (doneRatio !== undefined && doneRatio !== null) issueUpdate.done_ratio = Number(doneRatio);
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

export async function getRedmineProjects(customConfig = null) {
  const config = customConfig || (await getRedmineConfig());
  if (!config.apiKey) return [];
  const res = await fetch(`${config.baseUrl}/projects.json?limit=100`, {
    headers: getHeaders(config.apiKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.projects || [];
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
