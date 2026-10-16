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
import { createChatSession, createChatMessage, listChatSessions, getSettings, updateSettings, getApiKeys } from "@/lib/localDb";
import { startServerChatRun, isRunLiveForSession } from "@/lib/chat/serverRunManager";

const baseIssue = {
  id: 99,
  subject: "Fix issue with screenshot",
  project: { id: 10, name: "Sample Project" },
  description: "",
  attachments: [
    {
      id: 101,
      filename: "screenshot-error.png",
      content_type: "image/png",
      filesize: 1234,
      content_url: "https://redmine.test/attachments/download/101/screenshot-error.png",
    },
  ],
  journals: [
    {
      id: 1,
      user: { name: "QA Tester" },
      notes: "Error terjadi saat klik tombol seperti pada gambar !screenshot-error.png!",
      created_on: "2026-10-16T10:00:00Z",
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  getRedmineConfig.mockResolvedValue({
    baseUrl: "https://redmine.test",
    apiKey: "redmine-test-key",
    projectPaths: { 10: { path: "/project" } },
  });
  inspectLocalPath.mockReturnValue({ exists: true, isDir: true });
  listChatSessions.mockResolvedValue([]);
  createChatSession.mockResolvedValue({ id: "session-99" });
  getSettings.mockResolvedValue({});
  getApiKeys.mockResolvedValue([{ key: "test-ai-key" }]);
  startServerChatRun.mockResolvedValue({ id: "run-99" });
  createChatMessage.mockImplementation(async (_, message) => ({ id: "msg-99", ...message }));
  isRunLiveForSession.mockReturnValue(false);

  // Mock global.fetch for attachment download
  global.fetch = vi.fn().mockImplementation(async (url) => {
    if (String(url).includes("/attachments/download/")) {
      return {
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: async () => Buffer.from("fake-png-image-bytes"),
      };
    }
    return { ok: false, status: 404 };
  });
});

describe("Redmine Task Spawn with Image Attachments", () => {
  it("downloads images and passes them as attachments to chat message and vision LLM", async () => {
    getRedmineIssueDetail.mockResolvedValue(baseIssue);
    const response = await POST({ json: async () => ({ issueId: 99 }) });
    expect(response.status).toBe(200);

    // Verify chat message had attachments with dataUrl
    const savedMsg = createChatMessage.mock.calls[0][1];
    expect(savedMsg.attachments).toHaveLength(1);
    expect(savedMsg.attachments[0].name).toBe("screenshot-error.png");
    expect(savedMsg.attachments[0].dataUrl).toContain("data:image/png;base64,");

    // Verify LLM received multimodal user content with image_url
    const runArgs = startServerChatRun.mock.calls[0][0];
    const userMsgContent = runArgs.messages[0].content;
    expect(Array.isArray(userMsgContent)).toBe(true);
    expect(userMsgContent[0]).toMatchObject({ type: "text" });
    expect(userMsgContent[1]).toMatchObject({
      type: "image_url",
      image_url: { url: expect.stringContaining("data:image/png;base64,") },
    });

    // Verify prompt integrates comments when description is empty
    expect(savedMsg.content).toContain("Error terjadi saat klik tombol seperti pada gambar");
    expect(savedMsg.content).toContain("screenshot-error.png");
    expect(runArgs.systemPrompt).toContain("LAMPIRAN GAMBAR (SCREENSHOT)");
  });
});
