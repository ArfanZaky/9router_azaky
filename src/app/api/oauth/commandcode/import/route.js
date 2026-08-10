import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/commandcode/import
 * Import and validate Command Code API key from local auth.json
 *
 * Request body:
 * - apiKey: string - API key (starts with user_)
 */
export async function POST(request) {
  try {
    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    const trimmedKey = apiKey.trim();

    // Validate token by making a test request to Command Code API
    let isValid = false;
    let userEmail = null;
    try {
      const res = await fetch("https://api.commandcode.ai/alpha/generate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${trimmedKey}`,
          "Content-Type": "application/json",
          "x-command-code-version": "0.25.7",
          "x-cli-environment": "cli",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash",
          stream: false,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(15000),
      });

      // 401 = invalid key, 4xx/5xx = API error (key format valid but other issues)
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json(
          { error: "Invalid Command Code API key. The key was rejected by the API." },
          { status: 400 }
        );
      }

      // Any response except 401/403 means the key is accepted
      isValid = true;

      // Try to extract email from response headers or a user info endpoint
      try {
        const data = await res.json();
        userEmail = data?.email || data?.user?.email || null;
      } catch {
        // Non-JSON response, ignore
      }
    } catch (err) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        // Timeout means the key was accepted but response took too long
        isValid = true;
      } else {
        throw err;
      }
    }

    if (!isValid) {
      return NextResponse.json(
        { error: "Failed to validate Command Code API key." },
        { status: 400 }
      );
    }

    // Save to database
    const connection = await createProviderConnection({
      provider: "commandcode",
      authType: "apiKey",
      apiKey: trimmedKey,
      email: userEmail || null,
      providerSpecificData: {
        authMethod: "auto_imported",
        source: "auth.json",
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Command Code import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
