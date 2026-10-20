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

const originalFetch = globalThis.fetch;

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

    // But an active session tagged with redmineIssueId: 19025 exists in SQLite
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
