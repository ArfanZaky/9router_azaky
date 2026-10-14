import { NextResponse } from "next/server";
import path from "node:path";
import {
  gitProjectStatus,
  gitStagePath,
  gitUnstagePath,
  gitDiscardPath,
  gitCommitChanges,
  gitUndoLastCommit,
  gitPushBranch,
  gitPullBranch,
  gitDiffPath,
  gitDiffForCommit,
  gitLogGraph,
  gitCommitDetail,
  gitCommitFileDiff,
  gitCheckoutBranch,
  listGitRepositories,
  resolveProjectWorkspace,
} from "@/lib/chat/projectWorkspace.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeys, getProviderConnections } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

function extractTextFromChoices(data) {
  const choice = data?.choices?.[0];
  if (!choice) return "";
  const msg = choice.message || choice.delta || {};
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    const combined = msg.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ((!part?.type || part.type === "text" || part.type === "output_text") && typeof part?.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("")
      .trim();
    if (combined) return combined;
  }
  const rawReasoning = (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim())
    || (typeof msg.reasoning === "string" && msg.reasoning.trim())
    || "";
  if (rawReasoning) {
    const lines = rawReasoning.split("\n").map((l) => l.trim()).filter(Boolean);
    const candidate = lines.find((l) => /^(?:feat|fix|chore|refactor|docs|test|perf|style)(?:\([^)]+\))?:/i.test(l));
    if (candidate) return candidate;
    return rawReasoning;
  }
  return "";
}

function validateWorkspaceBoundary(targetPath, rootPath) {
  if (!rootPath) return true;
  try {
    const resolvedTarget = resolveProjectWorkspace(targetPath);
    const resolvedRoot = resolveProjectWorkspace(rootPath);
    if (!resolvedTarget || !resolvedRoot) return false;
    if (resolvedTarget === resolvedRoot) return true;
    const relChild = path.relative(resolvedRoot, resolvedTarget);
    if (!relChild.startsWith("..") && !path.isAbsolute(relChild)) return true;
    const relParent = path.relative(resolvedTarget, resolvedRoot);
    if (!relParent.startsWith("..") && !path.isAbsolute(relParent)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetPath = String(body.path || "").trim();
    const rootPath = String(body.rootPath || "").trim();
    const action = String(body.action || "status").trim().toLowerCase();

    if (!targetPath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    // Safety boundary check if rootPath is specified
    if (rootPath && !validateWorkspaceBoundary(targetPath, rootPath)) {
      return NextResponse.json({ error: "Target path outside workspace boundary" }, { status: 403 });
    }

    if (action === "repos") {
      const repos = listGitRepositories(targetPath);
      return NextResponse.json({ repos });
    }

    if (action === "status") {
      return NextResponse.json(gitProjectStatus(targetPath, rootPath || null));
    }

    if (action === "graph") {
      const maxCount = Number(body.maxCount) || 80;
      const branch = body.branch ? String(body.branch).trim() : null;
      const graphData = gitLogGraph(targetPath, { maxCount, branch });
      const scanTarget = rootPath ? resolveProjectWorkspace(rootPath) || targetPath : targetPath;
      const repos = listGitRepositories(scanTarget);
      return NextResponse.json({ ...graphData, repos });
    }

    if (action === "commit-detail") {
      const hash = String(body.hash || "").trim();
      if (!hash) {
        return NextResponse.json({ error: "Commit hash is required" }, { status: 400 });
      }
      const detail = gitCommitDetail(targetPath, hash);
      return NextResponse.json(detail);
    }

    if (action === "commit-diff") {
      const hash = String(body.hash || "").trim();
      const file = String(body.file || "").trim();
      if (!hash || !file) {
        return NextResponse.json({ error: "Commit hash and file are required" }, { status: 400 });
      }
      const diff = gitCommitFileDiff(targetPath, hash, file);
      return NextResponse.json({ diff });
    }

    if (action === "checkout") {
      const branch = String(body.branch || "").trim();
      if (!branch) {
        return NextResponse.json({ error: "Branch name is required" }, { status: 400 });
      }
      const message = gitCheckoutBranch(targetPath, branch);
      const graphData = gitLogGraph(targetPath, { maxCount: 80 });
      return NextResponse.json({ ok: true, message, ...graphData });
    }

    if (action === "diff") {
      const file = String(body.file || "");
      const staged = Boolean(body.staged);
      const diff = gitDiffPath(targetPath, file, staged);
      return NextResponse.json({ diff });
    }

    // Generate commit message ONLY - executes NO modifying git actions!
    if (action === "generate-commit-message") {
      const diffInfo = gitDiffForCommit(targetPath);
      let model = String(body.model || "").trim();

      if (!model) {
        try {
          const connections = await getProviderConnections().catch(() => []);
          const activeConn = connections.find((c) => c.status === "active" || c.isActive !== false);
          if (activeConn?.models?.[0]?.id) {
            model = `${activeConn.id || activeConn.provider}/${activeConn.models[0].id}`;
          }
        } catch {
          // ignore
        }
      }
      if (!model) {
        model = "ag/gemini-3.8-flash-high";
      }

      const apiKeys = await getApiKeys().catch(() => []);
      const activeKey = apiKeys.find((k) => k.isActive !== false)?.key || "";

      await ensureTranslators();

      const systemPrompt = `You are an expert Git commit message generator.
Generate a concise, high quality conventional commit message based on the provided git diff and file changes.

Rules:
1. Output ONLY the commit message text.
2. Strictly DO NOT include markdown code fences (no \`\`\`), no quotes, no conversational filler, no greetings, no git commands (do not output "git commit -m ...").
3. Format:
   <type>(<optional scope>): <imperative summary in present tense>

   [optional body explaining what and why if changes are non-trivial]
   
   Types: feat, fix, refactor, chore, docs, test, style, perf.
4. Keep the subject line under 72 characters.`;

      const userContent = `File changes:\n${diffInfo.statusSummary || "(no status output)"}\n\nDiff:\n${diffInfo.diff}`;

      const payload = {
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
        max_tokens: 800,
      };

      const headers = {
        "Content-Type": "application/json",
        ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
      };

      const inProcessReq = new Request("http://9router.local/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const chatRes = await handleChat(inProcessReq, {
        endpoint: "/api/v1/chat/completions",
        body: payload,
        headers,
      });

      const data = await chatRes.json().catch(() => ({}));
      if (!chatRes.ok || data.error) {
        throw new Error(data.error?.message || data.error || `AI generation failed (${chatRes.status})`);
      }

      let generatedMessage = extractTextFromChoices(data).trim();
      if (generatedMessage.startsWith("```")) {
        generatedMessage = generatedMessage.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
      }
      generatedMessage = generatedMessage.replace(/^["']|["']$/g, "").trim();

      if (!generatedMessage) {
        throw new Error("AI returned an empty commit message. Please try again or type message manually.");
      }

      return NextResponse.json({
        ok: true,
        message: generatedMessage,
      });
    }

    let message = "";
    let extraData = {};

    if (action === "stage") {
      message = gitStagePath(targetPath, body.file);
    } else if (action === "unstage") {
      message = gitUnstagePath(targetPath, body.file);
    } else if (action === "discard") {
      message = gitDiscardPath(targetPath, body.file, Boolean(body.isUntracked));
    } else if (action === "commit") {
      const commitRes = gitCommitChanges(targetPath, body.message, { stageAll: Boolean(body.stageAll) });
      message = commitRes.message;
    } else if (action === "undo-commit") {
      const undoRes = gitUndoLastCommit(targetPath);
      message = undoRes.message;
      extraData = { undoneMessage: undoRes.undoneMessage };
    } else if (action === "push") {
      message = gitPushBranch(targetPath, { remote: body.remote, branch: body.branch });
    } else if (action === "pull") {
      message = gitPullBranch(targetPath);
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Return the updated status along with action message
    const updatedStatus = gitProjectStatus(targetPath, rootPath || null);
    return NextResponse.json({
      ok: true,
      message,
      status: updatedStatus,
      ...extraData,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Git operation failed" },
      { status: 400 }
    );
  }
}
