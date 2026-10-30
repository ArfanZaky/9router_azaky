import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { extractRenderResult, parseCliJson, renderFlowJob } from "../../src/lib/flow/driver.js";

describe("gflow output parsing", () => {
  it("parses a clean json body", () => {
    expect(parseCliJson('{"media_path":"a.mp4"}')).toEqual({ media_path: "a.mp4" });
  });

  // The CLI prints Rich banners unless --json suppresses them; a stray line must
  // not turn a paid render into "no output".
  it("parses json surrounded by noise", () => {
    const stdout = 'Starting...\n{"video": {"url": "https://x/y.mp4"}}\ntrailing';
    expect(parseCliJson(stdout)).toEqual({ video: { url: "https://x/y.mp4" } });
  });

  it("returns null when there is no json at all", () => {
    expect(parseCliJson("boom")).toBeNull();
    expect(parseCliJson("")).toBeNull();
  });

  it("finds the media path and url in a nested result", () => {
    const stdout = JSON.stringify({
      ok: true,
      generation: { media_path: "/tmp/out/clip.mp4", video_url: "https://example.com/clip.mp4" },
    });
    expect(extractRenderResult(stdout)).toMatchObject({
      mediaPath: "/tmp/out/clip.mp4",
      sourceUrl: "https://example.com/clip.mp4",
    });
  });

  it("falls back to a url printed in plain text", () => {
    const { sourceUrl } = extractRenderResult("saved: https://cdn.example.com/a.mp4 done");
    expect(sourceUrl).toBe("https://cdn.example.com/a.mp4");
  });
});

describe("flow driver refuses what it cannot do", () => {
  // i2v now runs on the real composer, but it must still fail before the browser
  // opens whenever the target project is unknown: a submit into the wrong project
  // spends credits and lands the clip somewhere nobody looks.
  it("rejects i2v without a project, before any browser work", async () => {
    const { renderFlowInComposer } = await import("../../src/lib/flow/composer.js");
    const previous = process.env.FLOW_PROJECT_ID;
    delete process.env.FLOW_PROJECT_ID;
    try {
      await expect(
        renderFlowInComposer({ id: "probe", mode: "i2v", model: "omni-flash", prompt: "x", duration: 4, aspect: "16:9", imagePath: "x.png" })
      ).rejects.toThrow(/needs a Flow project/);
    } finally {
      if (previous !== undefined) process.env.FLOW_PROJECT_ID = previous;
    }
  });

  // A stray test run must never pay for a render.
  it("refuses to render inside a test run without RUN_FLOW=1", async () => {
    await expect(
      renderFlowJob({ id: "probe", mode: "i2v", model: "omni-flash", prompt: "x", duration: 4, aspect: "16:9", imagePath: "x.png" })
    ).rejects.toThrow(/Refusing to render Flow inside a test run/);
  });
});

// Opt-in: a real render spends real credits (omni-flash 360p 10s = 7).
// RUN_FLOW=1 npx vitest run --config ./vitest.config.js tests/unit/flow-driver.test.js
describe.skipIf(process.env.RUN_FLOW !== "1")("flow render against the live Flow account", () => {
  it("renders one clip, stores the mp4, and charges the table price", async () => {
    const { enqueueFlowJob, refreshFlowCredits } = await import("../../src/lib/flow/bridge.js");
    const { getFlowJob } = await import("../../src/lib/db/repos/flowRepo.js");

    const before = await refreshFlowCredits();

    const job = await enqueueFlowJob({
      prompt: "A single ceramic coffee mug on a wooden table, slow push-in, soft window light, no text.",
      model: "omni-flash",
      duration: 4,
      aspect: "16:9",
    });
    // 4s omni-flash at the 720p this host renders: the cheapest real render.
    expect(job.creditCost).toBe(7);

    let current = job;
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      current = await getFlowJob(job.id);
      if (current.status === "completed" || current.status === "failed") break;
    }

    expect(current.error || "").toBe("");
    expect(current.status).toBe("completed");
    expect(current.mediaPath).toBeTruthy();
    expect(existsSync(current.mediaPath)).toBe(true);
    expect(statSync(current.mediaPath).size).toBeGreaterThan(100_000);

    const after = await refreshFlowCredits();
    expect(before.balance - after.balance).toBe(7);
    console.log("[flow] rendered", current.mediaPath, `${before.balance} -> ${after.balance}`);
  }, 25 * 60 * 1000);
});
