import { describe, expect, it } from "vitest";

// Pure semantics for goal lifecycle and transcript windowing used by chat.
// Mirrors the DB-backed goal repo contract without requiring a live DB.

function makeGoalStore() {
  let goals = [];
  return {
    set(text) {
      const existing = goals.find((g) => g.status === "active");
      if (existing) {
        existing.text = text;
        return existing;
      }
      const g = { id: `g${goals.length + 1}`, text, status: "active", iterations: 0, judgeResult: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      goals.push(g);
      return g;
    },
    pause() {
      const g = goals.find((x) => x.status === "active");
      if (g) g.status = "paused";
      return g;
    },
    resume() {
      const g = goals.find((x) => x.status === "paused");
      if (g) g.status = "active";
      return g;
    },
    clear() {
      goals = goals.map((g) => g.status === "active" ? { ...g, status: "cleared" } : g);
      return true;
    },
    bump() {
      const g = goals.find((x) => x.status === "active");
      if (g) g.iterations += 1;
      return g;
    },
    complete(reason) {
      const g = goals.find((x) => x.status === "active");
      if (g) { g.status = "completed"; g.judgeResult = reason; }
      return g;
    },
    active() {
      return goals.find((x) => x.status === "active") || null;
    },
  };
}

function windowList(list, index, windowSize = 50) {
  if (list.length <= 120 || index < 0) return { list, start: 0, end: list.length };
  const start = Math.max(0, index - windowSize);
  const end = Math.min(list.length, index + windowSize + 1);
  return { list: list.slice(start, end), start, end };
}

describe("chat goal lifecycle semantics", () => {
  it("set creates an active goal and re-setting updates it", () => {
    const s = makeGoalStore();
    const a = s.set("Fix tests");
    expect(a.status).toBe("active");
    const b = s.set("Fix tests and deploy");
    expect(b.id).toBe(a.id);
    expect(b.text).toBe("Fix tests and deploy");
  });

  it("pause/resume/clear transitions", () => {
    const s = makeGoalStore();
    s.set("Ship it");
    expect(s.pause().status).toBe("paused");
    expect(s.resume().status).toBe("active");
    expect(s.clear()).toBe(true);
    expect(s.active()).toBeNull();
  });

  it("bump increments iterations and complete sets status", () => {
    const s = makeGoalStore();
    s.set("Verify");
    expect(s.bump().iterations).toBe(1);
    expect(s.complete("all green").status).toBe("completed");
    expect(s.active()).toBeNull();
  });
});

describe("chat transcript windowing", () => {
  it("renders everything under the threshold", () => {
    const list = Array.from({ length: 80 }, (_, i) => i);
    const w = windowList(list, -1);
    expect(w.list.length).toBe(80);
    expect(w.start).toBe(0);
    expect(w.end).toBe(80);
  });

  it("windows around the anchor for long lists", () => {
    const list = Array.from({ length: 300 }, (_, i) => i);
    const w = windowList(list, 200);
    expect(w.start).toBe(150);
    expect(w.end).toBe(251);
    expect(w.list[0]).toBe(150);
    expect(w.list.at(-1)).toBe(250);
  });

  it("clamps window to bounds", () => {
    const list = Array.from({ length: 300 }, (_, i) => i);
    const head = windowList(list, 5);
    expect(head.start).toBe(0);
    const tail = windowList(list, 299);
    expect(tail.end).toBe(300);
  });
});
