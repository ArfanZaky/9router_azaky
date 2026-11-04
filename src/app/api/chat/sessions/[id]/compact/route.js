import { NextResponse } from "next/server";
import { compactSessionMessages, compactStartIndex, getChatSession } from "@/lib/db/repos/chatRepo.js";
import { getApiKeys } from "@/lib/localDb";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

function extractText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : part?.text || extractText(part)))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof value === "object") {
    return value.content || value.text || value.message || "";
  }
  return String(value);
}

async function summarizeWithLlm(session, rowsToSummarize, overrideKey = "") {
  const model = session?.model || "";
  if (!model || !rowsToSummarize.length) return "";
  let apiKey = overrideKey;
  if (!apiKey) {
    const keys = await getApiKeys().catch(() => []);
    apiKey = (keys || []).find((k) => k.isActive !== false)?.key || "";
  }
  if (!apiKey) return "";

  const lines = [];
  if (session.compactSummary) {
    lines.push(`Previous summary:\n${session.compactSummary}`);
  }
  for (const m of rowsToSummarize) {
    if (m.role === "system") continue;
    const text = extractText(m.content).replace(/\s+/g, " ").trim();
    if (m.role === "user" && text) {
      lines.push(`User: ${text.slice(0, 1200)}`);
    } else if (m.role === "assistant") {
      const toolNames = (Array.isArray(m.tool_calls) ? m.tool_calls : [])
        .map((tc) => tc?.function?.name || tc?.name)
        .filter(Boolean);
      if (toolNames.length) {
        lines.push(`Assistant tools: ${[...new Set(toolNames)].join(", ")}`);
      }
      if (text) {
        lines.push(`Assistant: ${text.slice(0, 1200)}`);
      }
    }
  }
  if (lines.length === 0) return "";
  const transcriptText = lines.join("\n").slice(-24000);

  try {
    await ensureTranslators();
    const req = new Request("http://9router.local/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "Summarize the conversation transcript into a compact context digest. Preserve: 1) User goals and requirements, 2) Key technical decisions and root causes, 3) Files modified or created and commands run, 4) Current state and next steps. Use concise bullet points in the user's language. No filler and no em dashes.",
          },
          {
            role: "user",
            content: transcriptText,
          },
        ],
      }),
    });
    const res = await handleChat(req);
    if (!res.ok) return "";
    const data = await res.json().catch(() => ({}));
    return extractText(data.choices?.[0]?.message?.content).trim();
  } catch {
    return "";
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const keepLastN = body.keepLastN !== undefined ? Math.max(0, Number(body.keepLastN) || 0) : 0;

    const session = await getChatSession(id, { includeMessages: true });
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const allMsgs = session.messages || [];
    const cutIdx = keepLastN > 0 ? compactStartIndex(allMsgs, keepLastN) : allMsgs.length;
    const droppedMsgs = allMsgs.slice(0, cutIdx).filter((m) => m.role !== "system");

    let llmSummary = "";
    if (droppedMsgs.length > 0) {
      llmSummary = await summarizeWithLlm(session, droppedMsgs, body.apiKey);
    }

    const result = await compactSessionMessages(id, keepLastN, { summary: llmSummary });
    if (!result) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    return NextResponse.json(result);
  } catch (error) {
    console.log("Error compacting session:", error);
    return NextResponse.json({ error: error?.message || "Failed to compact session" }, { status: 500 });
  }
}
