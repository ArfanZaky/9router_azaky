import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/redmine/redmineClient", () => ({
  getRedmineConfig: vi.fn(),
  updateRedmineIssue: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getChatSession: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateChatSession: vi.fn(),
}));

vi.mock("@/lib/redmine/taskSpawner", () => ({
  findActiveRedmineSession: vi.fn(),
}));

import {
  formatRedmineCompletionComment,
  postTaskCompletionComment,
} from "@/lib/redmine/commentSummary";
import { getRedmineConfig, updateRedmineIssue } from "@/lib/redmine/redmineClient";
import { getChatSession, getSettings, updateSettings, updateChatSession } from "@/lib/localDb";
import { POST as postSummaryRoute } from "@/app/api/redmine/tasks/post-summary/route";
import { POST as statusRoute } from "@/app/api/redmine/tasks/status/route";
import { findActiveRedmineSession } from "@/lib/redmine/taskSpawner";

describe("Redmine Task Completion Comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatRedmineCompletionComment", () => {
    it("formats clean summary with title header, commit info, and footer", () => {
      const summary = "Pekerjaan selesai. File HeaderComponent.tsx telah diperbarui dengan button MyPoints.";
      const formatted = formatRedmineCompletionComment(summary, {
        commitMsg: "feat(#20232): add mypoints button",
        commitHash: "a1b2c3d",
      });

      expect(formatted).toContain("*Laporan Pengerjaan Task (9Router AI Worker)*");
      expect(formatted).toContain("File HeaderComponent.tsx telah diperbarui");
      expect(formatted).toContain("*Git Commit Lokal:*");
      expect(formatted).toContain("feat(#20232): add mypoints button");
      expect(formatted).toContain("(a1b2c3d)");
      expect(formatted).toContain("Pengerjaan telah selesai dan diverifikasi secara lokal di workspace.");
      // Anti-Slop R-02: No em dash
      expect(formatted).not.toContain("\u2014");
      expect(formatted).not.toContain("—");
    });

    it("strips internal verification tags and noise", () => {
      const raw = "Perbaikan bug selesai.\n(Verification passed)\n(Verification: gap found)\n(Run interrupted: none)\n[STATUS: DONE]\nDetail implementasi.";
      const formatted = formatRedmineCompletionComment(raw);

      expect(formatted).not.toContain("(Verification passed)");
      expect(formatted).not.toContain("[STATUS: DONE]");
      expect(formatted).toContain("Perbaikan bug selesai.");
      expect(formatted).toContain("Detail implementasi.");
    });
  });

  describe("postTaskCompletionComment", () => {
    it("throws error if issueId is missing", async () => {
      await expect(postTaskCompletionComment(null)).rejects.toThrow("issueId is required");
    });

    it("throws error if apiKey is not configured", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "" });
      await expect(postTaskCompletionComment(42)).rejects.toThrow("Redmine API key is not configured");
    });

    it("skips posting if autoCommentOnDone is false and not forced", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "test-key", autoCommentOnDone: false });
      const res = await postTaskCompletionComment(42, { summary: "Done" });

      expect(res.skipped).toBe(true);
      expect(res.ok).toBe(false);
      expect(updateRedmineIssue).not.toHaveBeenCalled();
    });

    it("posts comment and updates tracking when successful", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "test-key", autoCommentOnDone: true });
      updateRedmineIssue.mockResolvedValue({ ok: true, issueId: "20232" });
      getSettings.mockResolvedValue({ redmineTaskStatuses: { "20232": { status: "done" } } });
      updateSettings.mockResolvedValue({});
      getChatSession.mockResolvedValue({ id: "sess-1", projectMeta: { localStatus: "done" } });
      updateChatSession.mockResolvedValue({});

      const res = await postTaskCompletionComment(20232, {
        summary: "Fitur penambahan button selesai.",
        sessionId: "sess-1",
        commitMsg: "feat(#20232): button",
      });

      expect(res.ok).toBe(true);
      expect(res.commentSent).toBe(true);
      expect(updateRedmineIssue).toHaveBeenCalledTimes(1);
      expect(updateRedmineIssue).toHaveBeenCalledWith(
        "20232",
        expect.objectContaining({ notes: expect.stringContaining("Laporan Pengerjaan Task") }),
        expect.any(Object)
      );
      expect(updateSettings).toHaveBeenCalled();
      expect(updateChatSession).toHaveBeenCalledWith("sess-1", expect.objectContaining({
        projectMeta: expect.objectContaining({ summaryCommentSent: true }),
      }));
    });

    it("extracts summary from session if summary option is omitted", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "test-key", autoCommentOnDone: true });
      updateRedmineIssue.mockResolvedValue({ ok: true });
      getSettings.mockResolvedValue({});
      updateSettings.mockResolvedValue({});
      getChatSession.mockResolvedValue({
        id: "sess-2",
        messages: [
          { role: "user", content: "Kerjakan task #100" },
          { role: "assistant", content: "Task #100 telah selesai diimplementasikan." },
        ],
      });

      const res = await postTaskCompletionComment("100", {
        sessionId: "sess-2",
      });

      expect(res.ok).toBe(true);
      expect(res.commentSent).toBe(true);
      expect(updateRedmineIssue).toHaveBeenCalledWith(
        "100",
        expect.objectContaining({ notes: expect.stringContaining("Task #100 telah selesai diimplementasikan.") }),
        expect.any(Object)
      );
    });
  });

  describe("API Route POST /api/redmine/tasks/post-summary", () => {
    it("handles manual summary submission", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "test-key", autoCommentOnDone: true });
      updateRedmineIssue.mockResolvedValue({ ok: true });
      getSettings.mockResolvedValue({});
      updateSettings.mockResolvedValue({});
      findActiveRedmineSession.mockResolvedValue({ id: "sess-active" });
      getChatSession.mockResolvedValue({
        id: "sess-active",
        messages: [{ role: "assistant", content: "Ringkasan manual pengerjaan task." }],
      });

      const req = new Request("http://localhost/api/redmine/tasks/post-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: 20232 }),
      });

      const response = await postSummaryRoute(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.commentSent).toBe(true);
    });
  });

  describe("API Route POST /api/redmine/tasks/status with sendComment", () => {
    it("triggers summary comment when status is set to done with sendComment: true", async () => {
      getRedmineConfig.mockResolvedValue({ apiKey: "test-key", autoCommentOnDone: true });
      updateRedmineIssue.mockResolvedValue({ ok: true });
      getSettings.mockResolvedValue({ redmineTaskStatuses: {} });
      updateSettings.mockResolvedValue({});
      findActiveRedmineSession.mockResolvedValue({ id: "sess-3", title: "Task 3" });
      getChatSession.mockResolvedValue({
        id: "sess-3",
        messages: [{ role: "assistant", content: "Pengerjaan selesai." }],
      });

      const req = new Request("http://localhost/api/redmine/tasks/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId: "300", status: "done", sendComment: true }),
      });

      const response = await statusRoute(req);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.status).toBe("done");
      expect(data.summaryCommentSent).toBe(true);
    });
  });
});
