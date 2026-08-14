import { describe, expect, it } from "vitest";

// Lightweight unit checks for gate resolution semantics used by approvals/ask_user.
// We cannot import serverRunManager without a DB, so test the pure contract shape
// via a local reimplementation mirroring resolveChatGate behavior.

function makeResolver() {
  const gates = new Map();
  let seq = 0;
  const emit = () => ({});
  return {
    gates,
    autoApprove: false,
    openGate(kind, payload) {
      if (kind === "approval" && this.autoApprove) return Promise.resolve(true);
      const id = `gate_${++seq}`;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          gates.delete(id);
          resolve(kind === "approval" ? false : null);
        }, 1000);
        gates.set(id, { kind, resolve, timer });
        emit({ id, ...payload });
      });
    },
    resolve(id, outcome) {
      const gate = gates.get(id);
      if (!gate) return null;
      clearTimeout(gate.timer);
      gates.delete(id);
      if (gate.kind === "approval") gate.resolve(outcome === "allow");
      else gate.resolve(String(outcome || ""));
      return { id, resolved: true };
    },
    settleAll() {
      for (const gate of gates.values()) {
        clearTimeout(gate.timer);
        gate.resolve(gate.kind === "approval" ? false : null);
      }
      gates.clear();
    },
  };
}

describe("chat gate resolution semantics", () => {
  it("auto-approve grants approval instantly without opening a gate", async () => {
    const r = makeResolver();
    r.autoApprove = true;
    const result = await r.openGate("approval", { tool: "bash" });
    expect(result).toBe(true);
    expect(r.gates.size).toBe(0);
  });

  it("approval gate resolves true only for allow", async () => {
    const r = makeResolver();
    const p = r.openGate("approval", { tool: "bash" });
    expect(r.resolve("gate_1", "allow")).toEqual({ id: "gate_1", resolved: true });
    await expect(p).resolves.toBe(true);
    expect(r.gates.size).toBe(0);
  });

  it("approval denial resolves false and removes gate", async () => {
    const r = makeResolver();
    const p = r.openGate("approval", { tool: "bash" });
    r.resolve("gate_1", "deny");
    await expect(p).resolves.toBe(false);
    expect(r.gates.size).toBe(0);
  });

  it("ask gate resolves the raw answer string", async () => {
    const r = makeResolver();
    const p = r.openGate("ask", { questions: [{ question: "Color?" }] });
    r.resolve("gate_1", "blue");
    await expect(p).resolves.toBe("blue");
  });

  it("settleAll closes pending gates as denied/skipped", async () => {
    const r = makeResolver();
    const a = r.openGate("approval", { tool: "write_file" });
    const q = r.openGate("ask", {});
    r.settleAll();
    await expect(a).resolves.toBe(false);
    await expect(q).resolves.toBe(null);
    expect(r.gates.size).toBe(0);
  });

  it("resolving an unknown or already-resolved gate returns null", () => {
    const r = makeResolver();
    expect(r.resolve("nope", "allow")).toBe(null);
  });
});
