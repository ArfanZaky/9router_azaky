import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redmine/redmineClient", () => ({
  getRedmineConfig: vi.fn(),
  getRedmineIssueDetail: vi.fn(),
  inspectLocalPath: vi.fn(),
  getRedmineIssues: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  createChatSession: vi.fn(),
  createChatMessage: vi.fn(),
  listChatSessions: vi.fn(),
  getChatSession: vi.fn(),
  updateChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  getSettings: vi.fn(),
  getActiveChatRunForSession: vi.fn(),
  updateSettings: vi.fn(),
  getApiKeys: vi.fn(),
}));

vi.mock("@/lib/chat/serverRunManager", () => ({
  startServerChatRun: vi.fn(),
  isRunLiveForSession: vi.fn(),
}));

import { POST as statusPOST } from "@/app/api/redmine/tasks/status/route";
import { DELETE as sessionDELETE } from "@/app/api/chat/sessions/[id]/route";
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
  updateChatSession,
  deleteChatSession,
  getSettings,
  updateSettings,
  getApiKeys,
} from "@/lib/localDb";
import { startServerChatRun, isRunLiveForSession } from "@/lib/chat/serverRunManager";

const sampleIssue = {
  id: 19020,
  subject: "Fix login button styling",
  project: { id: 77, name: "CKB Portal" },
  description: "Perbaiki styling tombol login",
  journals: [],
  attachments: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  getRedmineConfig.mockResolvedValue({
    baseUrl: "https://redmine.test",
    apiKey: "test-redmine-key",
    projectPaths: { 77: { path: "F:\\project\\ckb-portal" } },
  });
  inspectLocalPath.mockReturnValue({ exists: true, isDir: true });
  getApiKeys.mockResolvedValue([{ key: "test-ai-key", isActive: true }]);
  startServerChatRun.mockResolvedValue({ id: "run-abc" });
  createChatMessage.mockImplementation(async (_, msg) => ({ id: "msg-1", ...msg }));
  isRunLiveForSession.mockReturnValue(false);
  updateSettings.mockResolvedValue({});
});

describe("Redmine 'Mark Working' Flow and Session Re-creation", () => {
  it("reuses existing chat session if valid session already exists", async () => {
    const existingSession = {
      id: "session-existing-123",
      title: "CKB Portal - Fix login button styling",
      projectMeta: { redmineIssueId: 19020, localStatus: "pending" },
    };

    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        19020: { status: "pending", sessionId: existingSession.id },
      },
    });
    getChatSession.mockResolvedValue(existingSession);
    listChatSessions.mockResolvedValue([existingSession]);
    updateChatSession.mockResolvedValue({ ...existingSession, projectMeta: { ...existingSession.projectMeta, localStatus: "working" } });

    const req = {
      json: async () => ({ issueId: 19020, status: "working" }),
    };

    const res = await statusPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.status).toBe("working");
    expect(data.sessionId).toBe("session-existing-123");
    expect(data.spawned).toBe(false);

    // Verify createChatSession was NOT called (no unnecessary duplicate)
    expect(createChatSession).not.toHaveBeenCalled();
    // Verify session projectMeta was updated
    expect(updateChatSession).toHaveBeenCalledWith("session-existing-123", expect.objectContaining({
      projectMeta: expect.objectContaining({ localStatus: "working" }),
    }));
  });

  it("spawns a new chat session when marked working if session was deleted", async () => {
    // Scenario: user previously had session 'session-old-deleted', but deleted it
    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        19020: { status: "working", sessionId: "session-old-deleted" },
      },
    });

    // When querying for the deleted session, it returns null
    getChatSession.mockImplementation(async (id) => {
      if (id === "session-old-deleted") return null;
      return null;
    });
    listChatSessions.mockResolvedValue([]); // No session exists in list

    getRedmineIssueDetail.mockResolvedValue(sampleIssue);
    const newlyCreatedSession = {
      id: "session-brand-new-456",
      title: "CKB Portal - Fix login button styling",
      workspacePath: "F:\\project\\ckb-portal",
      projectMeta: { redmineIssueId: 19020, localStatus: "working" },
    };
    createChatSession.mockResolvedValue(newlyCreatedSession);

    const req = {
      json: async () => ({ issueId: 19020, status: "working" }),
    };

    const res = await statusPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.status).toBe("working");
    expect(data.sessionId).toBe("session-brand-new-456");
    expect(data.spawned).toBe(true);

    // Verify a brand new session was created with full task context
    expect(createChatSession).toHaveBeenCalled();
    expect(startServerChatRun).toHaveBeenCalled();

    // Verify settings was updated with new sessionId
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      redmineTaskStatuses: expect.objectContaining({
        19020: expect.objectContaining({
          status: "working",
          sessionId: "session-brand-new-456",
        }),
      }),
    }));
  });

  it("cleans up redmineTaskStatuses when deleting a chat session", async () => {
    const sessionToDelete = {
      id: "session-to-delete",
      title: "CKB Portal - Fix login button styling",
      projectMeta: { redmineIssueId: 19020 },
    };

    getChatSession.mockResolvedValue(sessionToDelete);
    deleteChatSession.mockResolvedValue(true);
    getSettings.mockResolvedValue({
      redmineTaskStatuses: {
        19020: { status: "working", sessionId: "session-to-delete" },
        99999: { status: "working", sessionId: "other-session" },
      },
    });

    const res = await sessionDELETE({}, { params: Promise.resolve({ id: "session-to-delete" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify task 19020 was cleaned up from redmineTaskStatuses, but 99999 remains
    expect(updateSettings).toHaveBeenCalledWith({
      redmineTaskStatuses: {
        99999: { status: "working", sessionId: "other-session" },
      },
    });
  });
});
