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
      userInfo = await verifyRedmineConnection(config);
      verified = Boolean(userInfo);
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
    const { baseUrl, apiKey, userEmail } = body;

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: "baseUrl and apiKey are required" }, { status: 400 });
    }

    // Verify first before saving
    const testConfig = {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: apiKey.trim(),
    };
    const user = await verifyRedmineConnection(testConfig);

    const saved = await saveRedmineConfig({
      baseUrl: testConfig.baseUrl,
      apiKey: testConfig.apiKey,
      userEmail: userEmail || user?.mail || "",
      userId: user?.id || null,
      userName: user ? `${user.firstname || ""} ${user.lastname || ""}`.trim() : "",
    });

    return NextResponse.json({
      success: true,
      config: saved,
      user,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
