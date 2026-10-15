import { NextResponse } from "next/server";
import {
  getRedmineProjects,
  getKnownWorkspaces,
  getRedmineConfig,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const config = await getRedmineConfig();
    if (!config.apiKey) {
      return NextResponse.json(
        { error: "Redmine API key is not configured" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const assignedOnly = searchParams.get("assignedOnly") === "true";
    const scope = searchParams.get("scope") || "relevant";
    const showAll = searchParams.get("all") === "true" || scope === "all";

    const [projects, knownWorkspaces] = await Promise.all([
      getRedmineProjects(config, {
        all: true,
        search,
        relevantOnly: !showAll,
      }),
      getKnownWorkspaces().catch(() => []),
    ]);

    const filtered = assignedOnly
      ? projects.filter((p) => Boolean(p.localPath))
      : projects;

    return NextResponse.json({
      ok: true,
      projects: filtered,
      totalCount: filtered.length,
      scope: showAll ? "all" : "relevant",
      knownWorkspaces,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
