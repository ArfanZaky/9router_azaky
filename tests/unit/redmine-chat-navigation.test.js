import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listChatSessions: vi.fn(),
  getChatSession: vi.fn(),
  updateChatSession: vi.fn(),
}));

vi.mock("@/lib/redmine/taskSpawner", () => ({
  findActiveRedmineSession: vi.fn(),
  spawnRedmineTaskSession: vi.fn(),
}));

import { getRedmineIssues } from "@/lib/redmine/redmineClient";
import { POST as statusPOST } from "@/app/api/redmine/tasks/status/route";
import {
  getSettings,
  updateSettings,
  listChatSessions,
  getChatSession,
  updateChatSession,
} from "@/lib/localDb";
import { findActiveRedmineSession } from "@/lib/redmine/taskSpawner";

const config = {
  baseUrl: "https://redmine.test",
  apiKey: "test-redmine-key",
  projectPaths: { 101: { path: "F:\\project\\portal" } },
};

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = vi.fn();
  updateSettings.mockResolvedValue({});
  updateChatSession.mockResolvedValue({});
});

describe("Redmine Task Chat Navigation & Session Resolution", () => {
  it("resolves localSessionId directly from localTaskStatuses when valid", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        issues: [
          {
            id: 19020,
            subject: "Fix login button styling",
            project: { id: 101, name: "Portal" },
            status: { id: 1, name: "New" },
          },
        ],
      }),
    });

    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        "19020": {
          status: "pending",
          sessionId: "sess-19020-abc",
          sessionTitle: "Portal - Fix login button styling",
          reason: "Need DB connection",
        },
      },
    });

    listChatSessions.mockResolvedValue([
      { id: "sess-19020-abc", title: "Portal - Fix login button styling" },
    ]);

    const result = await getRedmineIssues({ customConfig: config });
    expect(result.issues.length).toBe(1);
    const issue = result.issues[0];

    expect(issue.localStatus).toBe("pending");
    expect(issue.localSessionId).toBe("sess-19020-abc");
    expect(issue.localSessionTitle).toBe("Portal - Fix login button styling");
    expect(issue.localStatusReason).toBe("Need DB connection");
  });

  it("self-heals localSessionId from projectMeta.redmineIssueId if localTaskStatuses lacked sessionId", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        issues: [
          {
            id: 19025,
            subject: "Fix dashboard metrics",
            project: { id: 101, name: "Portal" },
            status: { id: 1, name: "New" },
          },
        ],
      }),
    });

    // localTaskStatuses has status pending but sessionId was null
    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        "19025": {
          status: "pending",
          sessionId: null,
          reason: "Deskripsi butuh konfirmasi",
        },
      },
    });

    // An active session tagged with redmineIssueId: 19025 exists in SQLite
    const taggedSession = {
      id: "sess-tagged-19025",
      title: "Portal - Fix dashboard metrics",
      projectMeta: { redmineIssueId: 19025, localStatus: "pending" },
    };
    listChatSessions.mockResolvedValue([taggedSession]);

    const result = await getRedmineIssues({ customConfig: config });
    expect(result.issues.length).toBe(1);
    const issue = result.issues[0];

    expect(issue.localStatus).toBe("pending");
    expect(issue.localSessionId).toBe("sess-tagged-19025");
    expect(issue.localSessionTitle).toBe("Portal - Fix dashboard metrics");
  });

  it("picks the newest session when multiple sessions are tagged with the same issue ID", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        issues: [
          {
            id: 20023,
            subject: "Flag Unscheduled DPF",
            project: { id: 101, name: "Portal" },
            status: { id: 1, name: "New" },
          },
        ],
      }),
    });

    // No valid status in settings or invalid session in settings
    getSettings.mockResolvedValue({
      redmineTaskStatuses: {},
    });

    // listChatSessions returns newest first: sess-new then sess-old
    const newerSession = {
      id: "sess-new-20023",
      title: "Portal - Flag Unscheduled DPF (New)",
      projectMeta: { redmineIssueId: 20023, localStatus: "pending" },
      updatedAt: "2026-10-20T04:00:00.000Z",
    };
    const olderSession = {
      id: "sess-old-20023",
      title: "Portal - Flag Unscheduled DPF (Old)",
      projectMeta: { redmineIssueId: 20023, localStatus: "working" },
      updatedAt: "2026-10-15T01:00:00.000Z",
    };
    listChatSessions.mockResolvedValue([newerSession, olderSession]);

    const result = await getRedmineIssues({ customConfig: config });
    expect(result.issues.length).toBe(1);
    const issue = result.issues[0];

    // Must pick newerSession, NOT olderSession
    expect(issue.localSessionId).toBe("sess-new-20023");
    expect(issue.localSessionTitle).toBe("Portal - Flag Unscheduled DPF (New)");
    expect(issue.localStatus).toBe("pending");
  });

  it("self-heals when sessionId in localTaskStatuses was deleted from DB", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_count: 1,
        issues: [
          {
            id: 20024,
            subject: "Flag Buffer Stock DPF",
            project: { id: 101, name: "Portal" },
            status: { id: 1, name: "New" },
          },
        ],
      }),
    });

    // settings points to deleted session sess-deleted-id
    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        "20024": {
          status: "pending",
          sessionId: "sess-deleted-id",
          sessionTitle: "Deleted Session",
        },
      },
    });

    // Only sess-replacement-20024 exists in DB
    const replacementSession = {
      id: "sess-replacement-20024",
      title: "Portal - Flag Buffer Stock DPF (Active)",
      projectMeta: { redmineIssueId: 20024, localStatus: "pending" },
    };
    listChatSessions.mockResolvedValue([replacementSession]);

    const result = await getRedmineIssues({ customConfig: config });
    expect(result.issues.length).toBe(1);
    const issue = result.issues[0];

    expect(issue.localSessionId).toBe("sess-replacement-20024");
    expect(issue.localSessionTitle).toBe("Portal - Flag Buffer Stock DPF (Active)");
  });

  it("preserves and returns sessionId when task is marked as pending via status API", async () => {
    const existingSession = {
      id: "sess-existing-pending",
      title: "Portal - Task 19030",
      projectMeta: { redmineIssueId: 19030, localStatus: "working" },
    };

    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        "19030": { status: "working", sessionId: "sess-existing-pending" },
      },
    });

    findActiveRedmineSession.mockResolvedValue(existingSession);

    const req = {
      json: async () => ({
        issueId: 19030,
        status: "pending",
        reason: "Waiting for user clarification",
      }),
    };

    const res = await statusPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.status).toBe("pending");
    expect(data.sessionId).toBe("sess-existing-pending");
    expect(data.sessionTitle).toBe("Portal - Task 19030");

    // Verify settings was saved with the active sessionId
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        redmineTaskStatuses: expect.objectContaining({
          "19030": expect.objectContaining({
            status: "pending",
            sessionId: "sess-existing-pending",
            reason: "Waiting for user clarification",
          }),
        }),
      })
    );
  });
});
