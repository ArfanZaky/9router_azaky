// Redmine due_date uses YYYY-MM-DD. ISO date strings sort chronologically without timezone conversion.
export function sortIssuesByDueDate(issues) {
  return [...issues].sort((a, b) => {
    const aDate = a.due_date || "";
    const bDate = b.due_date || "";
    if (!aDate) return bDate ? 1 : 0;
    if (!bDate) return -1;
    return aDate.localeCompare(bDate);
  });
}
