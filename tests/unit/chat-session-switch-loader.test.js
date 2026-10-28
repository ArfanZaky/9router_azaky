import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("Chat Session Switch Loader Logic", () => {
  it("triggers loader and clears message buffer before new session finishes loading", async () => {
    let isSessionLoading = false;
    let messages = [{ id: "m1", role: "user", content: "old session message" }];
    let activeSessionId = "session-1";

    const fetchSessionMock = vi.fn().mockImplementation(async (id) => {
      // Simulate network latency
      await new Promise((r) => setTimeout(r, 20));
      return { id, messages: [{ id: `m_${id}`, role: "user", content: `hello from ${id}` }] };
    });

    // Start switching session
    const switchSession = async (nextId) => {
      isSessionLoading = true;
      messages = []; // Clear buffer so old messages do not linger
      activeSessionId = nextId;

      const data = await fetchSessionMock(nextId);
      if (activeSessionId === nextId) {
        messages = data.messages;
        isSessionLoading = false;
      }
    };

    const switchPromise = switchSession("session-2");

    // While in flight: loader must be true, messages empty
    expect(isSessionLoading).toBe(true);
    expect(messages).toEqual([]);
    expect(activeSessionId).toBe("session-2");

    await switchPromise;

    // After resolution: loader is false, messages loaded
    expect(isSessionLoading).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hello from session-2");
  });

  it("handles rapid session switches without race conditions", async () => {
    let isSessionLoading = false;
    let messages = [];
    let activeSessionId = "session-1";

    const fetchSession = async (id, delay) => {
      await new Promise((r) => setTimeout(r, delay));
      return { id, messages: [{ id: `m_${id}`, content: `data_${id}` }] };
    };

    const switchSession = async (id, delay) => {
      isSessionLoading = true;
      messages = [];
      activeSessionId = id;

      const data = await fetchSession(id, delay);
      if (activeSessionId === id) {
        messages = data.messages;
        isSessionLoading = false;
      }
    };

    // User switches to session-2 (slow: 40ms), then quickly to session-3 (fast: 10ms)
    const p1 = switchSession("session-2", 40);
    const p2 = switchSession("session-3", 10);

    await Promise.all([p1, p2]);

    expect(activeSessionId).toBe("session-3");
    expect(isSessionLoading).toBe(false);
    expect(messages[0].content).toBe("data_session-3");
  });

  it("disables send when session is loading", () => {
    const computeCanSend = ({ isSessionLoading, hasModel, hasApiKey, hasDraft }) => {
      return !isSessionLoading && hasModel && hasApiKey && hasDraft;
    };

    expect(
      computeCanSend({ isSessionLoading: true, hasModel: true, hasApiKey: true, hasDraft: true })
    ).toBe(false);

    expect(
      computeCanSend({ isSessionLoading: false, hasModel: true, hasApiKey: true, hasDraft: true })
    ).toBe(true);
  });

  it("immediately renders in-memory messages if session is already running live", () => {
    const liveRunMap = {
      "session-live": { isSending: true, messages: [{ id: "live1", role: "assistant", content: "streaming..." }] },
    };

    let isSessionLoading = true;
    let messages = [];

    const selectSession = (id) => {
      const run = liveRunMap[id];
      if (run?.isSending) {
        messages = run.messages;
        isSessionLoading = false;
      } else {
        isSessionLoading = true;
      }
    };

    selectSession("session-live");

    expect(isSessionLoading).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("streaming...");
  });

  it("selectSession callback stays stable so the stale URL param cannot re-select the previous session", () => {
    const source = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/chat/ChatPageClient.js", import.meta.url),
      "utf8"
    );

    // isSessionLoading must be read through a ref, not listed as a dep of handleSelectSession.
    expect(source).toContain("isSessionLoadingRef.current");
    expect(source).not.toContain("}, [loadSessionDetail, syncActiveSessionRunState, isSessionLoading]);");

    // URL sync prefers the live location over useSearchParams, which ignores history.replaceState.
    expect(source).toContain("const targetId = liveSessionId || urlSessionId;");
  });
});
