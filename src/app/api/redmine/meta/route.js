import { NextResponse } from "next/server";
import {
  getRedmineProjects,
  getRedmineStatuses,
  getRedmineTrackers,
  getRedminePriorities,
  getTimeEntryActivities,
  getRedmineConfig,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getRedmineConfig();
    const [projects, statuses, trackers, priorities, timeEntryActivities] = await Promise.all([
      getRedmineProjects(config).catch(() => []),
      getRedmineStatuses(config).catch(() => []),
      getRedmineTrackers(config).catch(() => []),
      getRedminePriorities(config).catch(() => []),
      getTimeEntryActivities(config).catch(() => []),
    ]);

    return NextResponse.json({
      config: {
        baseUrl: config.baseUrl,
        userEmail: config.userEmail,
        userId: config.userId,
        userName: config.userName,
        autoWorkWithAi: config.autoWorkWithAi === true,
        aiModel: config.aiModel || "anthropic/claude-3-7-sonnet",
        autoCommentOnDone: config.autoCommentOnDone !== false,
      },
      projects,
      statuses,
      trackers,
      priorities,
      timeEntryActivities,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
