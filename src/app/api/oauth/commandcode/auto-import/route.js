import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * GET /api/oauth/commandcode/auto-import
 * Auto-detect and extract Command Code API key from local auth file.
 * Reads ~/.commandcode/auth.json.
 */
export async function GET() {
  try {
    const home = homedir();
    const authPath = join(home, ".commandcode", "auth.json");

    let content;
    try {
      content = await readFile(authPath, "utf-8");
    } catch {
      return NextResponse.json({
        found: false,
        error: `Command Code auth file not found at ${authPath}. Please install Command Code CLI and login first.`,
      });
    }

    let authData;
    try {
      authData = JSON.parse(content);
    } catch {
      return NextResponse.json({
        found: false,
        error: "Invalid JSON in Command Code auth file.",
      });
    }

    // Command Code auth.json typically has { "apiKey": "user_..." } or similar
    const apiKey =
      authData.apiKey ||
      authData.accessToken ||
      authData.access_token ||
      authData.token ||
      null;

    if (!apiKey || typeof apiKey !== "string" || !apiKey.startsWith("user_")) {
      return NextResponse.json({
        found: true,
        raw: authData,
        error: "No valid Command Code API key (user_...) found in auth.json.",
      });
    }

    return NextResponse.json({
      found: true,
      apiKey,
      source: authPath,
      // Include any additional useful info
      email: authData.email || null,
      accountId: authData.accountId || authData.userId || null,
    });
  } catch (error) {
    console.log("Command Code auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
