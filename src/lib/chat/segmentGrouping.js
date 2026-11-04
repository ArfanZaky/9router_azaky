/**
 * Group consecutive reasoning and tool segments inside an assistant message
 * into a single collapsible "activity" block while keeping text segments separate.
 * ponytail: linear single-pass grouping; expand to sub-agent tree only if nested traces are needed.
 */
export function groupMessageSegments(segments = [], { showReasoning = true, viewMode = "raw" } = {}) {
  const groups = [];
  let currentActivity = [];

  const flushActivity = () => {
    if (currentActivity.length > 0) {
      groups.push({ kind: "activity", items: currentActivity });
      currentActivity = [];
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    if (seg.type === "reasoning") {
      if (showReasoning && seg.content) {
        currentActivity.push({ ...seg, originalIndex: i });
      }
      continue;
    }

    if (seg.type === "tool") {
      if (viewMode === "raw") {
        currentActivity.push({ ...seg, originalIndex: i });
      }
      continue;
    }

    if (seg.type === "text") {
      if (seg.content) {
        flushActivity();
        groups.push({ kind: "text", segment: seg, originalIndex: i });
      }
      continue;
    }
  }

  flushActivity();
  return groups;
}
