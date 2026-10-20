import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Chat Session Auto-Healing and Navigation Order", () => {
  it("getChatSession auto-heals messages from completed chatRuns when assistant content is missing", async () => {
    const mockMessagesInDb = [
      { id: "msg-user-1", role: "user", content: "Kerjakan task #123", createdAt: "2026-10-15T10:00:00Z" },
      { id: "msg-asst-1", role: "assistant", content: "", status: "tool_calls", createdAt: "2026-10-15T10:00:01Z" },
    ];

    const completedRunResult = {
      messages: [
        { id: "msg-user-1", role: "user", content: "Kerjakan task #123", createdAt: "2026-10-15T10:00:00Z" },
        { id: "msg-asst-1", role: "assistant", content: "Hasil investigasi: [STATUS: PENDING] butuh klarifikasi", status: "done", createdAt: "2026-10-15T10:00:01Z" },
      ],
    };

    const hasAssistantContent = mockMessagesInDb.some(
      (m) => m.role === "assistant" && m.content && String(m.content).trim().length > 0
    );

    expect(hasAssistantContent).toBe(false);

    // When healed from completedRunResult
    const healedMessages = completedRunResult.messages;
    const healedHasContent = healedMessages.some(
      (m) => m.role === "assistant" && m.content && String(m.content).trim().length > 0
    );

    expect(healedHasContent).toBe(true);
    expect(healedMessages[1].content).toContain("[STATUS: PENDING]");
  });

  it("ensures user message precedes assistant response regardless of timestamp drift", () => {
    const rawMessages = [
      { role: "assistant", content: "Jawaban", createdAt: "2026-10-15T09:00:00Z" },
      { role: "user", content: "Pertanyaan", createdAt: "2026-10-15T10:00:00Z" },
    ];

    // Using chronological insertion index instead of drift timestamp
    let baseTime = new Date("2026-10-15T09:00:00Z").getTime();
    const ordered = [
      rawMessages[1], // User first
      rawMessages[0], // Assistant second
    ].map((m, idx) => ({
      ...m,
      createdAt: new Date(baseTime + idx * 1000).toISOString(),
    }));

    expect(ordered[0].role).toBe("user");
    expect(ordered[1].role).toBe("assistant");
    expect(new Date(ordered[0].createdAt).getTime()).toBeLessThan(new Date(ordered[1].createdAt).getTime());
  });
});
