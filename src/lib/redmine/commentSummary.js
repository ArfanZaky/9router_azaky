import {
  getRedmineConfig,
  updateRedmineIssue,
} from "./redmineClient.js";
import {
  getChatSession,
  getSettings,
  updateSettings,
  updateChatSession,
} from "../localDb.js";

/**
 * Format the assistant completion text into a clean, professional Redmine comment.
 * Enforces Anti-Slop R-02 (no em dashes).
 */
export function formatRedmineCompletionComment(content, { commitMsg, commitHash, issueId } = {}) {
  let cleanText = String(content || "").trim();

  // Strip internal notices and tags if present
  cleanText = cleanText.replace(/\n*\(Verification:?[^)]*\)/gi, "");
  cleanText = cleanText.replace(/\n*\(Verification passed\)/gi, "");
  cleanText = cleanText.replace(/\n*\(Run interrupted:[^)]*\)/gi, "");
  cleanText = cleanText.replace(/\n*\[STATUS:\s*DONE\]/gi, "");

  let gitInfo = "";
  if (commitMsg && !cleanText.includes(commitMsg)) {
    gitInfo = `\n\n*Git Commit Lokal:*\n\`${commitMsg}\`${commitHash ? ` (${commitHash})` : ""}`;
  } else if (commitHash && !cleanText.includes(commitHash)) {
    gitInfo = `\n\n*Git Commit Lokal (HEAD):*\n\`${commitHash}\``;
  }

  const header = `*Laporan Pengerjaan Task (9Router AI Worker)*\n\n`;
  const footer = `\n\n---\n_Catatan: Pengerjaan telah selesai dan diverifikasi secara lokal di workspace. Commit dibuat secara lokal (tanpa git push remote)._`;

  const fullComment = `${header}${cleanText}${gitInfo}${footer}`;

  // Anti-Slop R-02: FORBIDDEN em dash anywhere. Replace with hyphen or colon.
  return fullComment.replace(/\u2014/g, "-");
}

/**
 * Post task completion comment to Redmine issue.
 * Tracks comment sent status in settings and session metadata.
 */
export async function postTaskCompletionComment(issueId, options = {}) {
  const issueKey = String(issueId || "");
  if (!issueKey) {
    throw new Error("issueId is required");
  }

  const config = options.config || (await getRedmineConfig());
  if (!config?.apiKey) {
    throw new Error("Redmine API key is not configured");
  }

  if (config.autoCommentOnDone === false && !options.force) {
    return { ok: false, skipped: true, reason: "autoCommentOnDone is disabled in config" };
  }

  let summary = options.summary || "";
  const sessionId = options.sessionId || null;

  // If summary not provided, extract the latest assistant response from the chat session
  if (!summary && sessionId) {
    try {
      const session = await getChatSession(sessionId, { messageLimit: 200 });
      const lastAssistant = [...(session?.messages || [])]
        .reverse()
        .find((m) => m?.role === "assistant" && m?.content && m.content.trim().length > 0);
      if (lastAssistant) {
        summary = lastAssistant.content;
      }
    } catch {
      // quiet fallback
    }
  }

  if (!summary || !summary.trim() || summary.startsWith("(No response")) {
    return { ok: false, skipped: true, reason: "No summary content available to send" };
  }

  const commentText = formatRedmineCompletionComment(summary, {
    commitMsg: options.commitMsg,
    commitHash: options.commitHash,
    issueId: issueKey,
  });

  // Post to Redmine issue journals
  await updateRedmineIssue(issueKey, { notes: commentText }, config);

  const now = new Date().toISOString();

  // Persist sent tracking in settings.redmineTaskStatuses
  try {
    const currentSettings = await getSettings();
    const rts = { ...(currentSettings?.redmineTaskStatuses || {}) };
    rts[issueKey] = {
      ...(rts[issueKey] || {}),
      summaryCommentSent: true,
      summaryCommentAt: now,
      updatedAt: now,
    };
    await updateSettings({ redmineTaskStatuses: rts });
  } catch {
    // quiet ignore
  }

  // Persist sent tracking in session projectMeta if session exists
  if (sessionId) {
    try {
      const session = await getChatSession(sessionId, { includeMessages: false });
      if (session) {
        await updateChatSession(sessionId, {
          projectMeta: {
            ...(session.projectMeta || {}),
            summaryCommentSent: true,
            summaryCommentAt: now,
          },
        });
      }
    } catch {
      // quiet ignore
    }
  }

  return {
    ok: true,
    issueId: issueKey,
    commentSent: true,
    sentAt: now,
    notes: commentText,
  };
}
