import { NextResponse } from "next/server";
import {
  getRedmineConfig,
  getRedmineIssueDetail,
  inspectLocalPath,
} from "@/lib/redmine/redmineClient";
import {
  createChatSession,
  createChatMessage,
  listChatSessions,
  getSettings,
  updateSettings,
  getApiKeys,
} from "@/lib/localDb";
import {
  startServerChatRun,
  isRunLiveForSession,
} from "@/lib/chat/serverRunManager";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const issueId = body.issueId || body.id;
    const forceNew = Boolean(body.forceNew);

    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }

    const config = await getRedmineConfig();
    if (!config.apiKey) {
      return NextResponse.json(
        { error: "Redmine API key is not configured" },
        { status: 400 }
      );
    }

    // 1. Fetch live issue details from Redmine
    const issue = await getRedmineIssueDetail(issueId, config);
    if (!issue) {
      return NextResponse.json({ error: `Issue #${issueId} not found` }, { status: 404 });
    }

    // 2. Check assigned local path
    const projectId = String(issue.project?.id || "");
    const projectIdent = String(issue.project?.identifier || "");
    const projectPaths = config.projectPaths || {};
    const assigned = projectPaths[projectId] || projectPaths[projectIdent];

    if (!assigned?.path) {
      return NextResponse.json(
        {
          error: `Project "${issue.project?.name}" belum di-assign local path. Silakan buka tab List Project dan assign local path terlebih dahulu.`,
        },
        { status: 400 }
      );
    }

    const inspection = inspectLocalPath(assigned.path);
    if (!inspection.exists || !inspection.isDir) {
      return NextResponse.json(
        {
          error: `Direktori local project tidak ditemukan: ${assigned.path}`,
        },
        { status: 400 }
      );
    }

    // 3. Check if session already exists for this issue
    const allSessions = await listChatSessions({ limit: 300 });
    const existing = allSessions.find(
      (s) => String(s.projectMeta?.redmineIssueId) === String(issue.id)
    );

    if (existing && !forceNew) {
      const isLive = isRunLiveForSession(existing.id);
      return NextResponse.json({
        ok: true,
        spawned: false,
        sessionId: existing.id,
        title: existing.title,
        workspacePath: existing.workspacePath || assigned.path,
        isLive,
        localStatus: existing.projectMeta?.localStatus || (isLive ? "working" : "pending"),
        message: isLive
          ? "Session sedang berjalan di background"
          : "Session sudah ada",
      });
    }

    // 4. Model & Key selection
    const modelCandidate =
      allSessions.find((s) => s.model)?.model || "anthropic/claude-3-7-sonnet";
    const providerCandidate =
      allSessions.find((s) => s.model)?.providerId ||
      (modelCandidate.includes("/") ? modelCandidate.split("/")[0] : "");

    const keys = await getApiKeys();
    const activeKey = keys.find((k) => k.isActive !== false)?.key || "";

    // 5. System prompt with explicit SQL prohibition, Git commit rules, and Anti-Slop
    const systemPrompt = `Act as an expert senior software engineer working in a dedicated Native Agent Team.
Workspace project path: ${assigned.path}

### CRITICAL RULES:
1. JANGAN PERNAH mengeksekusi perintah INSERT, UPDATE, DELETE, atau ALTER langsung ke database. Jika ada query perubahan database atau skema yang diperlukan, BUATLAH file migrasi skrip terpisah berekstensi .sql (contoh: migrations/xxx.sql).
2. Tulis kode yang bersih, modular, dan teruji sesuai standar kualitas tinggi (Anti-Slop standard).
3. Jangan mengubah status tiket Redmine di remote server; selesaikan pekerjaan di codebase lokal dan verifikasi dengan teliti.
4. GIT COMMIT LOKAL (JANGAN PUSH): Setelah seluruh perubahan selesai dan diverifikasi, lakukan git commit secara lokal (git add + git commit) dengan pesan commit yang jelas mencantumkan nomor tiket #${issue.id} (contoh: git commit -m "feat(#${issue.id}): ${issue.subject}"). DILARANG KERAS melakukan git push! Remote repository TIDAK BOLEH di-push.`;

    const userPrompt = `Kerjakan task Redmine berikut pada project ini:

**Tiket #${issue.id}: ${issue.subject}**
- **Project:** ${issue.project.name}
- **Tracker:** ${issue.tracker?.name || "Issue"}
- **Status Redmine:** ${issue.status?.name || "Open"}
- **Prioritas:** ${issue.priority?.name || "Normal"}

**Deskripsi Task:**
${issue.description ? issue.description.trim() : "(Tidak ada deskripsi rinci)"}

---
**ATURAN KERJA & BATASAN KEAMANAN:**
1. Analisis arsitektur dan file terkait di workspace (${assigned.path}) sebelum mengubah kode.
2. PERINGATAN KERAS DATABASE: JANGAN PERNAH melakukan INSERT, UPDATE, DELETE, atau ALTER langsung ke database mana pun. Jika butuh perubahan query/skema database, buat file skrip migrasi tersendiri berekstensi \`.sql\`.
3. Selesaikan implementasi atau perbaikan bug dengan teliti, dan pastikan tidak ada syntax error / build error.
4. LAKUKAN GIT COMMIT LOKAL SAJA (DILARANG GIT PUSH): Jika task sudah selesai dikerjakan dan diverifikasi, buat git commit lokal (git add + git commit -m '...') menyertakan nomor tiket #${issue.id}. JANGAN PERNAH mengeksekusi git push ke remote!
5. Jangan ubah status tiket Redmine remote; cukup berikan laporan ringkasan perubahan file setelah selesai.`;

    // 6. Spawn session with title: (project - title task)
    const sessionTitle = `${issue.project.name} - ${issue.subject}`;
    const session = await createChatSession({
      title: sessionTitle,
      model: modelCandidate,
      providerId: providerCandidate,
      workspacePath: assigned.path,
      codebase: assigned.path,
      projectMeta: {
        name: issue.project.name,
        redmineIssueId: issue.id,
        redmineProjectId: issue.project.id,
        redmineProjectName: issue.project.name,
        redmineIssueSubject: issue.subject,
        localStatus: "working",
        agentRole: "orchestrator",
      },
      systemPrompt,
    });

    // 7. Add initial user message
    await createChatMessage(session.id, {
      role: "user",
      content: userPrompt,
      status: "done",
    });

    // 8. Start agent run immediately
    let runId = null;
    if (activeKey) {
      const run = await startServerChatRun({
        sessionId: session.id,
        mode: "agent",
        providerId: providerCandidate,
        titleSeed: sessionTitle,
        model: modelCandidate,
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt,
        apiKey: activeKey,
        accessMode: "full",
        autoApprove: true,
        codebase: assigned.path,
        params: { temperature: 0.7, max_tokens: 4096 },
      });
      runId = run.id;
    }

    // 9. Update local status in settings
    const currentSettings = await getSettings();
    const rts = { ...(currentSettings?.redmineTaskStatuses || {}) };
    rts[String(issue.id)] = {
      status: "working",
      sessionId: session.id,
      sessionTitle,
      runId,
      updatedAt: new Date().toISOString(),
    };
    await updateSettings({ redmineTaskStatuses: rts });

    return NextResponse.json({
      ok: true,
      spawned: true,
      sessionId: session.id,
      title: sessionTitle,
      workspacePath: assigned.path,
      localStatus: "working",
      runId,
      hasKey: Boolean(activeKey),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
