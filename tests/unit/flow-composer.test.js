import { describe, expect, it } from "vitest";

import { composePrompt, profileDir } from "../../src/lib/flow/composer.js";
import { flowPriceTable } from "../../src/lib/flow/bridge.js";
import { flowCreditCost } from "../../open-sse/providers/registry/flow.js";

describe("flow composer prompt", () => {
  // Flow's agent reads model/duration/aspect out of prose. If they are missing it
  // picks its own defaults, and the credit charged then does not match the table.
  it("states duration, aspect and model so the render matches the price", () => {
    const prompt = composePrompt({ prompt: "lima orang makan", duration: 4, aspect: "16:9", model: "omni-flash" });
    expect(prompt).toContain("4 detik");
    expect(prompt).toContain("16:9");
    expect(prompt).toContain("omni-flash");
    expect(prompt.startsWith("lima orang makan")).toBe(true);
  });

  it("keeps the user prompt verbatim before the instruction", () => {
    const raw = "a dog\nwith a newline";
    expect(composePrompt({ prompt: raw, duration: 8, aspect: "9:16" })).toContain(raw);
  });
});

describe("flow profile resolution", () => {
  it("uses FLOW_PROFILE_DIR when set", () => {
    const previous = process.env.FLOW_PROFILE_DIR;
    process.env.FLOW_PROFILE_DIR = "C:/tmp/profile";
    expect(profileDir()).toBe("C:/tmp/profile");
    if (previous === undefined) delete process.env.FLOW_PROFILE_DIR;
    else process.env.FLOW_PROFILE_DIR = previous;
  });

  it("otherwise derives a directory from the gflow data dir", () => {
    const previous = process.env.FLOW_PROFILE_DIR;
    delete process.env.FLOW_PROFILE_DIR;
    const dir = profileDir();
    expect(dir).toMatch(/ffroliva[\\/]gflow-cli[\\/]profile_/);
    if (previous !== undefined) process.env.FLOW_PROFILE_DIR = previous;
  });
});

describe("flow price table", () => {
  // The whole point of the table is the per-second rate: veo-fast costs 20
  // credits for 4s and for 8s, so 4s is twice as expensive per second.
  it("shows per-second cost that depends on duration for flat-priced models", () => {
    const { models } = flowPriceTable();
    const fast = models.find((m) => m.id === "veo-fast");
    const four = fast.costs.find((c) => c.duration === 4);
    const eight = fast.costs.find((c) => c.duration === 8);
    expect(four.credits).toBe(eight.credits);
    expect(four.perSecond).toBe(5);
    expect(eight.perSecond).toBe(2.5);
  });

  it("pins omni-flash to the resolution this host actually renders", () => {
    const { hostResolution, models } = flowPriceTable();
    const omni = models.find((m) => m.id === "omni-flash");
    expect(omni.costs.every((c) => c.resolution === hostResolution)).toBe(true);
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: hostResolution })).toBe(omni.costs.find((c) => c.duration === 4).credits);
  });

  it("offers no resolution row for models that have none", () => {
    const { models } = flowPriceTable();
    const lite = models.find((m) => m.id === "veo-lite");
    expect(lite.costs.every((c) => c.resolution === null)).toBe(true);
  });
});
