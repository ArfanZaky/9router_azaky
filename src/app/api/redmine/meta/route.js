import { NextResponse } from "next/server";
import {
  getRedmineProjects,
  getRedmineStatuses,
  getRedmineTrackers,
  getRedmineConfig,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getRedmineConfig();
    const [projects, statuses, trackers] = await Promise.all([
      getRedmineProjects(config).catch(() => []),
      getRedmineStatuses(config).catch(() => []),
      getRedmineTrackers(config).catch(() => []),
    ]);

    return NextResponse.json({
      config: {
        baseUrl: config.baseUrl,
        userEmail: config.userEmail,
        userId: config.userId,
        userName: config.userName,
      },
      projects,
      statuses,
      trackers,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
