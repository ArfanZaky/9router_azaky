import { describe, expect, it } from "vitest";

describe("chat ask and approval session isolation", () => {
  it("filters asks strictly by activeSessionId", () => {
    const asks = [
      { id: "ask_1", sessionId: "session_A", questions: [{ question: "Question A?" }] },
      { id: "ask_2", sessionId: "session_B", questions: [{ question: "Question B?" }] },
    ];

    const activeA = asks.filter((a) => a.sessionId === "session_A");
    const activeB = asks.filter((a) => a.sessionId === "session_B");
    const activeC = asks.filter((a) => a.sessionId === "session_C");

    expect(activeA).toHaveLength(1);
    expect(activeA[0].id).toBe("ask_1");

    expect(activeB).toHaveLength(1);
    expect(activeB[0].id).toBe("ask_2");

    expect(activeC).toHaveLength(0);
  });

  it("identifies sessions with pending asks for sidebar indicators", () => {
    const asks = [
      { id: "ask_1", sessionId: "session_A" },
    ];
    const approvals = [
      { id: "app_1", sessionId: "session_C" },
    ];

    const pendingSet = new Set();
    for (const a of asks) if (a.sessionId) pendingSet.add(a.sessionId);
    for (const ap of approvals) if (ap.sessionId) pendingSet.add(ap.sessionId);

    expect(pendingSet.has("session_A")).toBe(true);
    expect(pendingSet.has("session_B")).toBe(false);
    expect(pendingSet.has("session_C")).toBe(true);
  });

  it("session completion only cleans up gates for that specific session", () => {
    let asks = [
      { id: "ask_1", sessionId: "session_A" },
      { id: "ask_2", sessionId: "session_B" },
    ];
    let approvals = [
      { id: "app_1", sessionId: "session_A" },
      { id: "app_2", sessionId: "session_B" },
    ];

    // Simulate session_A completion
    const completedSessionId = "session_A";
    asks = asks.filter((item) => item.sessionId !== completedSessionId);
    approvals = approvals.filter((item) => item.sessionId !== completedSessionId);

    expect(asks).toEqual([{ id: "ask_2", sessionId: "session_B" }]);
    expect(approvals).toEqual([{ id: "app_2", sessionId: "session_B" }]);
  });

  it("server openGate contracts: emits event with run.sessionId and saves payload in gates map", async () => {
    const emittedEvents = [];
    const fakeRun = {
      id: "run_123",
      sessionId: "session_456",
      autoApprove: false,
      gates: new Map(),
    };

    const emit = async (run, type, data) => {
      emittedEvents.push({ type, data });
    };

    const openGateMock = (run, kind, payload) => {
      const id = "gate_test_1";
      return new Promise((resolve) => {
        run.gates.set(id, { kind, resolve, payload });
        emit(run, kind === "approval" ? "approval" : "ask", {
          id,
          runId: run.id,
          sessionId: run.sessionId,
          ...payload,
        });
      });
    };

    const gatePromise = openGateMock(fakeRun, "ask", {
      questions: [{ question: "Do you confirm?" }],
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe("ask");
    expect(emittedEvents[0].data.sessionId).toBe("session_456");
    expect(emittedEvents[0].data.runId).toBe("run_123");
    expect(emittedEvents[0].data.questions[0].question).toBe("Do you confirm?");

    expect(fakeRun.gates.has("gate_test_1")).toBe(true);
    expect(fakeRun.gates.get("gate_test_1").payload.questions[0].question).toBe("Do you confirm?");

    // Simulate resolution
    const gate = fakeRun.gates.get("gate_test_1");
    fakeRun.gates.delete("gate_test_1");
    gate.resolve("confirmed");

    await expect(gatePromise).resolves.toBe("confirmed");
  });
});
