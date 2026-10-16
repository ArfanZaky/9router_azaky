import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redmine/redmineClient", () => ({
  getRedmineConfig: vi.fn(),
  getRedmineIssues: vi.fn(),
  getRedmineIssueDetail: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(), getActiveChatRunForSession: vi.fn() }));
vi.mock("@/lib/chat/serverRunManager", () => ({ isRunLiveForSession: vi.fn() }));

import { POST } from "@/app/api/redmine/tasks/auto-work/route";
import { getRedmineConfig, getRedmineIssues, getRedmineIssueDetail } from "@/lib/redmine/redmineClient";
import { getSettings } from "@/lib/localDb";
import { isRunLiveForSession } from "@/lib/chat/serverRunManager";

const pending = { id: 42, subject: "Task", localPath: "/project", projectAutoWork: true, localStatus: "pending", localSessionId: "session-42" };
const journals = [{ id: 1, notes: "Awal" }, { id: 2, notes: "Instruksi tambahan" }];
const request = { nextUrl: { origin: "http://localhost:3000" } };

beforeEach(() => {
  vi.resetAllMocks();
  getRedmineConfig.mockResolvedValue({ apiKey: "redmine-test", autoWorkWithAi: true, aiModel: "anthropic/test" });
  getRedmineIssues.mockResolvedValue({ issues: [pending] });
  getRedmineIssueDetail.mockResolvedValue({ journals });
  getSettings.mockResolvedValue({ redmineTaskStatuses: { 42: { status: "pending", sessionId: "session-42", lastInstructionCommentKey: "1" } } });
  isRunLiveForSession.mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, spawned: true, sessionId: "session-42" }) }));
});

describe("Redmine auto work pending instructions", () => {
  it("requests continuation when there is a new comment", async () => {
    const response = await (await POST(request)).json();
    expect(response).toMatchObject({ spawnedCount: 1, totalEligible: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ issueId: 42 });
  });

  it("does not restart on unchanged notes or change-only journals", async () => {
    getRedmineIssueDetail.mockResolvedValue({ journals: [journals[0], { id: 2, notes: "", details: [] }] });
    const response = await (await POST(request)).json();
    expect(response.spawnedCount).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not interrupt a live session", async () => {
    isRunLiveForSession.mockReturnValue(true);
    await POST(request);
    expect(getRedmineIssueDetail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not auto-start when auto-work is disabled", async () => {
    getRedmineConfig.mockResolvedValue({ apiKey: "test", autoWorkWithAi: false });
    await POST(request);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts tasks that have never been worked", async () => {
    getRedmineIssues.mockResolvedValue({ issues: [{ ...pending, localStatus: null, localSessionId: null }] });
    const response = await (await POST(request)).json();
    expect(response.spawnedCount).toBe(1);
    expect(getRedmineIssueDetail).not.toHaveBeenCalled();
  });
});
