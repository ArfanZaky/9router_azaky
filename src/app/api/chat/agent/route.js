import { createAgentSseResponse, runAgentLoop } from "@/lib/agent/loop.js";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const model = body.model;
  if (!model) return Response.json({ error: "model is required" }, { status: 400 });
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  const apiKey =
    body.apiKey ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  const origin = body.origin || new URL(request.url).origin;
  const workspace = body.workspace || process.cwd();
  const accessMode = body.accessMode === "full" ? "full" : "sandbox";
  const maxSteps = Math.min(Math.max(Number(body.maxSteps) || 12, 1), 30);
  const params = body.params || {};

  // Abort when client disconnects
  const ac = new AbortController();
  request.signal?.addEventListener?.("abort", () => ac.abort());

  return createAgentSseResponse(async (onEvent) => {
    onEvent("status", {
      phase: "init",
      workspace,
      dataDir: DATA_DIR,
      origin,
      accessMode,
    });
    await runAgentLoop({
      model,
      messages: body.messages,
      systemPrompt: body.systemPrompt || "",
      apiKey,
      workspace,
      origin,
      accessMode,
      maxSteps,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      top_p: params.top_p,
      signal: ac.signal,
      onEvent,
    });
  });
}
