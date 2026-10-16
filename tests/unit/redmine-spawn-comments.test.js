import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redmine/redmineClient", () => ({
  getRedmineConfig: vi.fn(),
  getRedmineIssueDetail: vi.fn(),
  inspectLocalPath: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  createChatSession: vi.fn(),
  createChatMessage: vi.fn(),
  listChatSessions: vi.fn(),
  getChatSession: vi.fn(),
  updateChatSession: vi.fn(),
  getSettings: vi.fn(),
  getActiveChatRunForSession: vi.fn(),
  updateSettings: vi.fn(),
  getApiKeys: vi.fn(),
}));
vi.mock("@/lib/chat/serverRunManager", () => ({
  startServerChatRun: vi.fn(),
  isRunLiveForSession: vi.fn(),
}));

import { POST } from "@/app/api/redmine/tasks/spawn/route";
import { getRedmineConfig, getRedmineIssueDetail, inspectLocalPath } from "@/lib/redmine/redmineClient";
import { createChatSession, createChatMessage, listChatSessions, getChatSession, updateChatSession, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import { startServerChatRun, isRunLiveForSession } from "@/lib/chat/serverRunManager";

const baseIssue = {
  id: 42,
  subject: "Implement fitur",
  project: { id: 10, name: "Sample" },
  description: "Implementasi awal",
};

beforeEach(() => {
  vi.resetAllMocks();
  getRedmineConfig.mockResolvedValue({ apiKey: "redmine-test", projectPaths: { 10: { path: "/project" } } });
  inspectLocalPath.mockReturnValue({ exists: true, isDir: true });
  listChatSessions.mockResolvedValue([]);
  createChatSession.mockResolvedValue({ id: "session-42" });
  getSettings.mockResolvedValue({});
  getApiKeys.mockResolvedValue([{ key: "test-key" }]);
  startServerChatRun.mockResolvedValue({ id: "run-42" });
  createChatMessage.mockImplementation(async (_, message) => ({ id: "new-message", ...message }));
  isRunLiveForSession.mockReturnValue(false);
});

async function spawn(issue) {
  getRedmineIssueDetail.mockResolvedValue(issue);
  const response = await POST({ json: async () => ({ issueId: 42 }) });
  expect(response.status).toBe(200);
  expect((await response.json()).spawned).toBe(true);
  expect(updateSettings).toHaveBeenCalled();
  const storedPrompt = createChatMessage.mock.calls[0][1].content;
  expect(startServerChatRun.mock.calls[0][0].messages[0].content).toBe(storedPrompt);
  return storedPrompt;
}

describe("Redmine Work with AI ticket instructions", () => {
  it("includes all notes in journal order alongside the description, but not change-only journals", async () => {
    const prompt = await spawn({
      ...baseIssue,
      journals: [
        { id: 1, user: { name: "Alice" }, created_on: "2026-10-10T09:00:00Z", notes: "Tambahkan laporan." },
        { id: 2, notes: "  ", details: [{ name: "status_id", new_value: "2" }] },
        { id: 3, user: { name: "Bob" }, created_on: "2026-10-11T10:00:00Z", notes: "  Gunakan filter harian.  " },
      ],
    });
    expect(prompt).toContain("**Deskripsi Task:**\nImplementasi awal");
    expect(prompt).toContain("**Komentar/Catatan Tiket (urut sesuai riwayat Redmine):**");
    expect(prompt).toContain("- Alice (2026-10-10T09:00:00Z):\nTambahkan laporan.");
    expect(prompt).toContain("- Bob (2026-10-11T10:00:00Z):\nGunakan filter harian.");
    expect(prompt.indexOf("Tambahkan laporan.")).toBeLessThan(prompt.indexOf("Gunakan filter harian."));
    expect(prompt).not.toContain("status_id");
    expect(createChatSession.mock.calls[0][0].systemPrompt).toContain("deskripsi DAN komentar/catatan tiket");
  });

  it("uses comments even when the description is empty", async () => {
    const prompt = await spawn({ ...baseIssue, description: "", journals: [{ notes: "Terapkan validasi input." }] });
    expect(prompt).toContain("(Tidak ada deskripsi rinci)");
    expect(prompt).toContain("Terapkan validasi input.");
    expect(prompt).not.toContain("(Tidak ada komentar)");
  });

  it("handles tickets without comments", async () => {
    const prompt = await spawn({ ...baseIssue, journals: undefined });
    expect(prompt).toContain("Implementasi awal");
    expect(prompt).toContain("(Tidak ada komentar)");
  });
});


describe("pending Redmine task follow-up", () => {
  const prior = { id: "session-42", title: "Sample - Implement fitur", model: "anthropic/test", systemPrompt: "Rules", projectMeta: { redmineIssueId: 42, localStatus: "pending", lastInstructionCommentKey: "1" } };
  const notes = [
    { id: 1, notes: "Instruksi awal", created_on: "2026-10-10T09:00:00Z" },
    { id: 2, notes: "Tambahkan filter baru", created_on: "2026-10-11T09:00:00Z" },
  ];
  beforeEach(() => {
    listChatSessions.mockResolvedValue([prior]);
    getChatSession.mockResolvedValue({ ...prior, messages: [
      { id: "old-user", role: "user", content: "Tolong kerjakan task" },
      { id: "old-ai", role: "assistant", content: "[STATUS: PENDING] Perlu klarifikasi." },
    ] });
    getSettings.mockResolvedValue({ redmineTaskStatuses: { 42: { sessionId: prior.id, status: "pending", lastInstructionCommentKey: "1" } } });
    getRedmineIssueDetail.mockResolvedValue({ ...baseIssue, journals: notes });
  });

  it("resumes the same session with only the new comment and chat history", async () => {
    const result = await (await POST({ json: async () => ({ issueId: 42 }) })).json();
    expect(result).toMatchObject({ spawned: true, resumed: true, sessionId: "session-42" });
    expect(createChatSession).not.toHaveBeenCalled();
    expect(startServerChatRun.mock.calls[0][0].messages.at(-1).content).toContain("Tambahkan filter baru");
    expect(startServerChatRun.mock.calls[0][0].messages.at(-1).content).not.toContain("Instruksi awal");
    expect(startServerChatRun.mock.calls[0][0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(startServerChatRun.mock.calls[0][0].redmineFollowUp).toBe(true);
    expect(updateSettings.mock.calls.at(-1)[0].redmineTaskStatuses[42]).toMatchObject({ status: "working", lastInstructionCommentKey: "2" });
  });

  it("does not rerun without a later nonblank note", async () => {
    getRedmineIssueDetail.mockResolvedValue({ ...baseIssue, journals: [notes[0], { id: 2, notes: "  " }] });
    const result = await (await POST({ json: async () => ({ issueId: 42 }) })).json();
    expect(result.spawned).toBe(false);
    expect(startServerChatRun).not.toHaveBeenCalled();
  });

  it("does not interrupt a live run even if a note arrived", async () => {
    isRunLiveForSession.mockReturnValue(true);
    const result = await (await POST({ json: async () => ({ issueId: 42 }) })).json();
    expect(result.spawned).toBe(false);
    expect(startServerChatRun).not.toHaveBeenCalled();
  });


  it("uses a timestamp baseline for pending sessions created before journal cursors existed", async () => {
    getSettings.mockResolvedValue({ redmineTaskStatuses: { 42: {
      sessionId: prior.id, status: "pending", finishedAt: "2026-10-10T10:00:00Z",
    } } });
    listChatSessions.mockResolvedValue([{ ...prior, projectMeta: { redmineIssueId: 42, localStatus: "pending" } }]);
    getChatSession.mockResolvedValue({ ...prior, projectMeta: { redmineIssueId: 42, localStatus: "pending" }, messages: [] });
    getRedmineIssueDetail.mockResolvedValue({ ...baseIssue, journals: notes });
    const result = await (await POST({ json: async () => ({ issueId: 42 }) })).json();
    expect(result.resumed).toBe(true);
    expect(startServerChatRun.mock.calls[0][0].messages.at(-1).content).toContain("Tambahkan filter baru");
  });

  it("serializes duplicate requests for a pending comment", async () => {
    const req = () => POST({ json: async () => ({ issueId: 42 }) });
    const [first, second] = await Promise.all([req(), req()]);
    expect((await first.json()).spawned).toBe(true);
    expect((await second.json()).spawned).toBe(false);
    expect(startServerChatRun).toHaveBeenCalledTimes(1);
  });
});
