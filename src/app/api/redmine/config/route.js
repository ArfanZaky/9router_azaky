import { NextResponse } from "next/server";
import {
  getRedmineConfig,
  saveRedmineConfig,
  verifyRedmineConnection,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getRedmineConfig();
    let verified = false;
    let userInfo = null;
    let error = null;

    try {
      if (config.apiKey) {
        userInfo = await verifyRedmineConnection(config);
        verified = Boolean(userInfo);
      }
    } catch (e) {
      error = e.message;
    }

    return NextResponse.json({
      config: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        userEmail: config.userEmail,
        userId: config.userId,
        userName: config.userName,
        autoWorkWithAi: config.autoWorkWithAi === true,
        aiModel: config.aiModel || "anthropic/claude-3-7-sonnet",
      },
      verified,
      user: userInfo,
      error,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const current = await getRedmineConfig();

    const baseUrl = (body.baseUrl || current.baseUrl || "https://redmine.profescipta.co.id").replace(/\/+$/, "");
    const apiKey = (body.apiKey !== undefined && body.apiKey !== null && body.apiKey.trim() !== "")
      ? body.apiKey.trim()
      : current.apiKey;
    const userEmail = body.userEmail !== undefined ? body.userEmail.trim() : current.userEmail;
    const autoWorkWithAi = body.autoWorkWithAi !== undefined ? Boolean(body.autoWorkWithAi) : current.autoWorkWithAi;
    const aiModel = body.aiModel ? String(body.aiModel).trim() : current.aiModel;

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    let user = null;
    if (apiKey) {
      const testConfig = { baseUrl, apiKey };
      user = await verifyRedmineConnection(testConfig);
    }

    const saved = await saveRedmineConfig({
      baseUrl,
      apiKey: apiKey || "",
      userEmail: userEmail || user?.mail || "",
      userId: user?.id || current.userId || null,
      userName: user ? `${user.firstname || ""} ${user.lastname || ""}`.trim() : current.userName,
      autoWorkWithAi,
      aiModel,
    });

    return NextResponse.json({
      success: true,
      config: saved,
      user: user || { id: saved.userId, mail: saved.userEmail, name: saved.userName },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
