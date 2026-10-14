import { NextResponse } from "next/server";
import { loadAllSkillIndex } from "@/lib/agent/skills.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const list = loadAllSkillIndex();
    const skills = list.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      isAntiSlop: s.id === "antislop" || s.id.startsWith("antislop-"),
      repoUrl: (s.id === "antislop" || s.id.startsWith("antislop-"))
        ? "https://github.com/miqdadbadjuber/anti-slop"
        : null,
    }));
    return NextResponse.json({
      total: skills.length,
      antiSlopActive: true,
      skills,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to load skills" }, { status: 500 });
  }
}
