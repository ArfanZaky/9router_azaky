import { describe, expect, it } from "vitest";
import {
  abortChatRun,
  clearChatRun,
  getActiveRunSessions,
  getChatRun,
  isRunActiveFor,
  startChatRun,
} from "../../src/lib/chat/chatRunRuntime.js";

function fakeRun(sessionId) {
  return startChatRun({
    sessionId,
    runId: `run_${sessionId}`,
    abortController: new AbortController(),
    messages: [],
    assistantId: `a_${sessionId}`,
    assistantText: "",
    agentStatus: "",
    titleSeed: "t",
    sessionMeta: {},
  });
}

describe("chatRunRuntime multi-session", () => {
  it("tracks multiple active runs independently", () => {
    const a = fakeRun("sessA");
    const b = fakeRun("sessB");
    expect(getChatRun("sessA")).toBe(a);
    expect(getChatRun("sessB")).toBe(b);
    expect(isRunActiveFor("sessA")).toBe(true);
    expect(isRunActiveFor("sessB")).toBe(true);
    expect(getActiveRunSessions().sort()).toEqual(["sessA", "sessB"]);
  });

  it("clearing one session does not affect the other", () => {
    fakeRun("sessA");
    fakeRun("sessB");
    clearChatRun("sessA");
    expect(getChatRun("sessA")).toBeNull();
    expect(isRunActiveFor("sessA")).toBe(false);
    expect(getChatRun("sessB")).not.toBeNull();
    expect(isRunActiveFor("sessB")).toBe(true);
  });

  it("abort targets only the named session", () => {
    const a = fakeRun("sessA");
    fakeRun("sessB");
    abortChatRun("sessA");
    expect(a.abortController.signal.aborted).toBe(true);
    expect(getChatRun("sessB").abortController.signal.aborted).toBe(false);
  });

  it("getChatRun() without arg returns focused (last started) run", () => {
    fakeRun("sessA");
    const b = fakeRun("sessB");
    expect(getChatRun()).toBe(b);
  });
});
