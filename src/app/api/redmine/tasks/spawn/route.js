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
  getChatSession,
  getSettings,
  getActiveChatRunForSession,
  updateSettings,
  getApiKeys,
} from "@/lib/localDb";
import {
  startServerChatRun,
  isRunLiveForSession,
} from "@/lib/chat/serverRunManager";

import { getInstructionComments, getNewInstructionComments, formatInstructionComments } from "@/lib/redmine/commentInstructions";

export const dynamic = "force-dynamic";

// Serialize starts for the same issue within this server process (dashboard and auto-work may race).
const issueStarts = globalThis.__redmineIssueStarts || new Map();
globalThis.__redmineIssueStarts = issueStarts;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.issueId || body.id || "");
  const previous = issueStarts.get(key);
  const job = (async () => {
    if (previous) {
      const priorResponse = await previous.catch(() => null);
      const priorResult = await priorResponse?.clone().json().catch(() => ({}));
      if (priorResult?.spawned && !body.forceNew) return NextResponse.json({ ...priorResult, spawned: false, message: "Session baru saja dijalankan" });
    }
    return spawnIssue(body);
  })();
  issueStarts.set(key, job);
  try {
    return await job;
  } finally {
    if (issueStarts.get(key) === job) issueStarts.delete(key);
  }
}

async function spawnIssue(body) {
  try {
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

    // 3. Reuse the tracked session. A pending ticket only resumes if a new
    // nonblank journal note arrived after the last instructions were consumed.
    const currentSettings = await getSettings();
    const tracked = currentSettings?.redmineTaskStatuses?.[String(issue.id)];
    const allSessions = await listChatSessions({ limit: 300 });
    const trackedSession = tracked?.sessionId
      ? await getChatSession(tracked.sessionId, { includeMessages: false })
      : null;
    const existing = trackedSession?.projectMeta?.redmineIssueId != null &&
      String(trackedSession.projectMeta.redmineIssueId) === String(issue.id)
      ? trackedSession
      : allSessions.find((s) => String(s.projectMeta?.redmineIssueId) === String(issue.id));
    const comments = getInstructionComments(issue);
    const lastCommentKey = comments.at(-1)?.key || null;

    if (existing && !forceNew) {
      const isLive = isRunLiveForSession(existing.id) || Boolean(await getActiveChatRunForSession(existing.id));
      const localStatus = tracked?.status || existing.projectMeta?.localStatus || (isLive ? "working" : "pending");
      const cursor = tracked?.lastInstructionCommentKey ?? existing.projectMeta?.lastInstructionCommentKey;
      const consumedAt = tracked?.finishedAt || tracked?.updatedAt || existing.createdAt;
      const newComments = getNewInstructionComments(comments, cursor, consumedAt);

      if (localStatus === "pending" && !isLive && newComments.length) {
        const keys = await getApiKeys();
        const activeKey = keys.find((k) => k.isActive !== false)?.key || "";
        if (!activeKey) return NextResponse.json({ error: "AI API key is not configured" }, { status: 400 });

        const instruction = `Tiket Redmine #${issue.id} sebelumnya PENDING. Ada komentar baru sebagai instruksi tambahan. Lanjutkan pekerjaan pada tiket yang sama dengan mempertimbangkan deskripsi, riwayat chat, dan klarifikasi baru berikut. Jika masih kurang jelas, laporkan [STATUS: PENDING] beserta pertanyaannya.\n\n**Komentar baru:**\n${formatInstructionComments(newComments)}`;
        const session = await getChatSession(existing.id, { messageLimit: 10000 });
        if (!session) return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
        // The follow-up must preserve enough history to answer the original
        // task, even for older sessions that have become very long.
        const model = body.model || session.model || config.aiModel;
        const providerId = model.includes("/") ? model.split("/")[0] : (session.providerId || "");
        const priorMessages = (session.messages || []).filter(
          (item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim()
        );
        const latestInstruction = { role: "user", content: instruction, status: "done" };
        const history = [...priorMessages, latestInstruction];
        const sessionTitle = existing.title;
        const nextStatuses = { ...(currentSettings?.redmineTaskStatuses || {}) };
        nextStatuses[String(issue.id)] = {
          ...tracked, status: "working", reason: null, sessionId: existing.id, sessionTitle,
          lastInstructionCommentKey: lastCommentKey, updatedAt: new Date().toISOString(),
        };
        await updateSettings({ redmineTaskStatuses: nextStatuses });
        let run;
        try {
          run = await startServerChatRun({
            sessionId: existing.id, mode: "agent", providerId, titleSeed: sessionTitle, model,
            messages: history.map(({ role, content }) => ({ role, content })),
            persistedMessages: history, systemPrompt: session.systemPrompt,
            redmineFollowUp: true,
            apiKey: activeKey, accessMode: "full", autoApprove: true,
            codebase: session.workspacePath || assigned.path,
            params: { temperature: 0.7, max_tokens: 4096 },
          });
        } catch (error) {
          await updateSettings({ redmineTaskStatuses: currentSettings?.redmineTaskStatuses || {} });
          throw error;
        }
        // The run starts asynchronously and could finish before this response.
        // Do not overwrite its final status with an old settings snapshot.
        return NextResponse.json({
          ok: true, spawned: true, resumed: true, sessionId: existing.id,
          title: sessionTitle, workspacePath: session.workspacePath || assigned.path,
          localStatus: "working", runId: run.id,
        });
      }

      return NextResponse.json({
        ok: true, spawned: false, sessionId: existing.id, title: existing.title,
        workspacePath: existing.workspacePath || assigned.path, isLive, localStatus,
        message: isLive ? "Session sedang berjalan di background" : "Belum ada komentar baru untuk dilanjutkan",
      });
    }

    // 4. Model & Key selection
    const requestedModel = body.model || config.aiModel;
    const modelCandidate =
      requestedModel ||
      allSessions.find((s) => s.model)?.model ||
      "anthropic/claude-3-7-sonnet";

    const providerCandidate =
      modelCandidate.includes("/") ? modelCandidate.split("/")[0] : "";

    const keys = await getApiKeys();
    const activeKey = keys.find((k) => k.isActive !== false)?.key || "";

    // 5. System prompt with explicit SQL prohibition, Git commit rules, ambiguity question rules, and Anti-Slop
    const systemPrompt = `Act as an expert senior software engineer working in a dedicated Native Agent Team.
Workspace project path: ${assigned.path}

### CRITICAL RULES:
1. ATURAN AKSES DATABASE:
   - Anda BOLEH mengakses database untuk query pembacaan data atau memeriksa skema, TETAPI HANYA QUERY SELECT SAJA (READ-ONLY).
   - JANGAN PERNAH mengeksekusi INSERT, UPDATE, DELETE, ALTER, DROP, atau TRUNCATE langsung ke database mana pun. Jika ada perubahan skema atau manipulasi data apa pun yang diperlukan (seperti INSERT data baru, UPDATE baris, DELETE, ALTER tabel, migrasi, seeder, dsb.), BUATLAH file skrip SQL tersendiri berekstensi .sql (contoh: migrations/xxx.sql atau scripts/xxx.sql). Dilarang mengeksekusi langsung ke database!
   - KONEKSI DATABASE GAGAL / TIDAK DAPAT DIAKSES: Jika task memerlukan koneksi ke database dan koneksi database tidak dapat terhubung / gagal connect / credentials tidak tersedia, JANGAN membuat asumsi spekulatif dan JANGAN memaksakan selesai. Jadikan status task PENDING dengan menyertakan teks persis: [STATUS: PENDING] di dalam jawaban akhir Anda, serta jelaskan kredensial atau akses database apa yang dibutuhkan.
2. ATURAN DESKRIPSI, KOMENTAR TIKET & PERTANYAAN (KLARIFIKASI):
   - Gunakan deskripsi DAN komentar/catatan tiket sebagai sumber instruksi. Perhatikan klarifikasi terbaru pada komentar jika ada.
   - Jika deskripsi dan komentar tiket kurang jelas, ambigu, spesifikasi kebutuhan belum lengkap, atau memerlukan konfirmasi/pertanyaan sebelum dieksekusi: JANGAN membuat asumsi spekulatif dan JANGAN memaksakan mengerjakan atau menyelesaikan task!
   - Jadikan status task menjadi PENDING dengan menyertakan teks persis: [STATUS: PENDING] di jawaban akhir Anda.
   - Tuliskan daftar/list pertanyaan konfirmasi yang jelas dan spesifik poin per poin (apa saja yang perlu diklarifikasi kepada user atau reporter tiket).
   - JANGAN melakukan git commit jika task berstatus PENDING.
3. Tulis kode yang bersih, modular, dan teruji sesuai standar kualitas tinggi (Anti-Slop standard: no em dashes, no dead code, mobile responsive).
4. Jangan mengubah status tiket Redmine di remote server; selesaikan pekerjaan di codebase lokal dan verifikasi dengan teliti.
5. GIT COMMIT LOKAL (JANGAN PUSH): Setelah seluruh perubahan selesai dan diverifikasi (jika BUKAN pending), lakukan git commit secara lokal (git add + git commit) dengan pesan commit yang jelas mencantumkan nomor tiket #${issue.id} (contoh: git commit -m "feat(#${issue.id}): ${issue.subject}"). DILARANG KERAS melakukan git push! Remote repository TIDAK BOLEH di-push.`;

    const userPrompt = `Kerjakan task Redmine berikut pada project ini:

**Tiket #${issue.id}: ${issue.subject}**
- **Project:** ${issue.project.name}
- **Tracker:** ${issue.tracker?.name || "Issue"}
- **Status Redmine:** ${issue.status?.name || "Open"}
- **Prioritas:** ${issue.priority?.name || "Normal"}

**Deskripsi Task:**
${issue.description ? issue.description.trim() : "(Tidak ada deskripsi rinci)"}

**Komentar/Catatan Tiket (urut sesuai riwayat Redmine):**
${comments.length ? formatInstructionComments(comments) : "(Tidak ada komentar)"}

Gunakan deskripsi dan komentar di atas sebagai instruksi task. Jika komentar terbaru memperjelas atau merevisi deskripsi/komentar sebelumnya, pertimbangkan klarifikasi tersebut.

---
**ATURAN KERJA & BATASAN KEAMANAN:**
1. Analisis arsitektur dan file terkait di workspace (${assigned.path}) sebelum mengubah kode.
2. ATURAN AKSES DATABASE:
   - Anda BOLEH mengakses database HANYA untuk query SELECT saja (read-only).
   - DILARANG KERAS mengeksekusi INSERT, UPDATE, DELETE, ALTER, DROP, atau modifikasi data/skema apa pun langsung ke database. Jika perlu melakukan perubahan skema maupun manipulasi data (seperti INSERT data, UPDATE data, DELETE, ALTER tabel, migrasi, seeder, dll.), BUATLAH file .sql tersendiri (contoh: migrations/xxx.sql atau scripts/xxx.sql). JANGAN eksekusi langsung ke database!
   - JIKA DATABASE TIDAK BISA KONEK: Jika task ini memerlukan koneksi ke database dan koneksi database tidak dapat terhubung, jangan paksakan selesai! Buat status task menjadi PENDING dengan menulis teks persis: [STATUS: PENDING] di laporan akhir Anda dan jelaskan kebutuhan koneksi DB-nya.
3. JIKA DESKRIPSI DAN KOMENTAR KURANG JELAS ATAU PERLU PERTANYAAN:
   - Jika deskripsi dan komentar tiket kurang jelas, ambigu, informasi kebutuhan belum lengkap, atau butuh konfirmasi/pertanyaan sebelum dikerjakan:
   - JANGAN berspekulasi atau berasumsi sendiri!
   - Buat status task menjadi PENDING dengan menulis teks persis: [STATUS: PENDING] di laporan akhir Anda.
   - Cantumkan daftar/list pertanyaan konfirmasi secara rinci dan terstruktur poin per poin.
   - JANGAN membuat git commit jika berstatus PENDING.
4. Selesaikan implementasi atau perbaikan bug dengan teliti, dan pastikan tidak ada syntax error / build error.
5. LAKUKAN GIT COMMIT LOKAL SAJA (DILARANG GIT PUSH): Jika task berhasil selesai (bukan pending), buat git commit lokal (git add + git commit -m '...') menyertakan nomor tiket #${issue.id}. JANGAN PERNAH mengeksekusi git push ke remote!
6. Jangan ubah status tiket Redmine remote; status akan dicatat di sistem lokal 9Router.`;

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
        lastInstructionCommentKey: lastCommentKey,
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
    const rts = { ...(currentSettings?.redmineTaskStatuses || {}) };
    rts[String(issue.id)] = {
      status: "working",
      sessionId: session.id,
      sessionTitle,
      runId,
      lastInstructionCommentKey: lastCommentKey,
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
