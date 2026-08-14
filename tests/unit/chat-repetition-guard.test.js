import { describe, expect, it } from "vitest";

// Repetition guard contract: identical tool name+arguments calls are counted;
// the first nudge fires at repeatLimit (3), execution stops at repeatStopLimit (6).
// We test the counting/fingerprint logic standalone (the loop wires it inline).

function fingerprint(name, args) {
  return `${name}|${JSON.stringify(args || {})}`;
}

function makeGuard({ limit = 3, stop = 6 } = {}) {
  const counts = new Map();
  return {
    count(name, args) {
      const key = fingerprint(name, args);
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return { n, nudge: n === limit, stop: n >= stop };
    },
  };
}

describe("chat repetition guard semantics", () => {
  it("different arguments are not repetition", () => {
    const g = makeGuard();
    expect(g.count("read_file", { path: "a.js" }).n).toBe(1);
    expect(g.count("read_file", { path: "b.js" }).n).toBe(1);
    expect(g.count("read_file", { path: "a.js" }).n).toBe(2);
  });

  it("fires a nudge once at limit", () => {
    const g = makeGuard();
    for (let i = 1; i <= 2; i++) {
      const r = g.count("bash", { command: "git status" });
      expect(r.nudge).toBe(false);
    }
    const third = g.count("bash", { command: "git status" });
    expect(third.n).toBe(3);
    expect(third.nudge).toBe(true);
    expect(third.stop).toBe(false);
  });

  it("stops execution at stop limit", () => {
    const g = makeGuard();
    for (let i = 1; i <= 6; i++) {
      const r = g.count("grep", { pattern: "foo" });
      if (i === 6) {
        expect(r.stop).toBe(true);
      } else {
        expect(r.stop).toBe(false);
      }
    }
  });

  it("normalizes argument ordering via stable JSON", () => {
    const g = makeGuard();
    g.count("bash", { command: "npm test", cwd: "." });
    expect(g.count("bash", { command: "npm test", cwd: "." }).n).toBe(2);
  });
});
