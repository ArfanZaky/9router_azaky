// Journal IDs are stable across Redmine issue fetches. Ignore change-only entries:
// only notes with actual text are instructions to the AI.
export function getInstructionComments(issue) {
  return (Array.isArray(issue?.journals) ? issue.journals : [])
    .filter((journal) => typeof journal?.notes === "string" && journal.notes.trim())
    .map((journal) => ({
      key: journal.id != null ? String(journal.id) : `${journal.created_on || ""}:${journal.notes.trim()}`,
      author: journal.user?.name || "Unknown",
      date: journal.created_on || "Unknown date",
      notes: journal.notes.trim(),
      createdOn: journal.created_on,
    }));
}

export function formatInstructionComments(comments) {
  return comments.map((comment) => `- ${comment.author} (${comment.date}):\n${comment.notes}`).join("\n\n");
}

// Older pending tasks may predate the journal cursor. For those, only notes
// posted after the last local status transition are considered new.
export function getNewInstructionComments(comments, cursor, consumedAt) {
  if (cursor != null) {
    const index = comments.findIndex((comment) => comment.key === String(cursor));
    if (index >= 0) return comments.slice(index + 1);
    // A missing cursor might mean Redmine returned a partial journal list.
    // Fail closed rather than treating old notes as fresh instructions.
    return [];
  }
  const baseline = Date.parse(consumedAt);
  return Number.isFinite(baseline)
    ? comments.filter((comment) => comment.createdOn && Date.parse(comment.createdOn) > baseline)
    : [];
}
