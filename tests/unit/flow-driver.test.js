import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extractRenderResult, parseCliJson, renderFlowJob } from "../../src/lib/flow/driver.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

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

describe("flow composer project resolution", () => {
  // i2v used to refuse without FLOW_PROJECT_ID, which made the dashboard's
  // "upload image" path dead on arrival. A project is only a container, so the
  // newest one on the account is used when the caller names none.
  const stubPage = (id) => ({
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => id,
  });

  it("falls back to the newest project listed on the Flow homepage", async () => {
    const { resolveProjectId } = await import("../../src/lib/flow/composer.js");
    const previous = process.env.FLOW_PROJECT_ID;
    delete process.env.FLOW_PROJECT_ID;
    try {
      expect(await resolveProjectId(stubPage("88062475-d441-46b7-b56e-e1590c5f9f7a"), null)).toBe(
        "88062475-d441-46b7-b56e-e1590c5f9f7a"
      );
      // An explicit hint wins without touching the page.
      expect(await resolveProjectId({ goto: () => { throw new Error("must not navigate"); } }, "hint-id")).toBe("hint-id");
    } finally {
      if (previous !== undefined) process.env.FLOW_PROJECT_ID = previous;
    }
  });

  it("stops with a clear message when the account has no project", async () => {
    const { resolveProjectId } = await import("../../src/lib/flow/composer.js");
    const previous = process.env.FLOW_PROJECT_ID;
    const previousBudget = process.env.FLOW_PROJECT_RESOLVE_MS;
    delete process.env.FLOW_PROJECT_ID;
    process.env.FLOW_PROJECT_RESOLVE_MS = "0";
    try {
      await expect(resolveProjectId(stubPage(null), null)).rejects.toThrow(/No Flow project/);
    } finally {
      if (previous !== undefined) process.env.FLOW_PROJECT_ID = previous;
      if (previousBudget === undefined) delete process.env.FLOW_PROJECT_RESOLVE_MS;
      else process.env.FLOW_PROJECT_RESOLVE_MS = previousBudget;
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

  // The dashboard's "upload an image" path: no project id is passed, so the
  // composer must pick one and upload the frame into it itself.
  it("renders one image-to-video clip without being told a project", async () => {
    const imagePath = join(repoRoot, "tmp", "gflow_input.png");
    if (!existsSync(imagePath)) return; // local sample frame only; nothing to prove otherwise

    const { enqueueFlowJob, refreshFlowCredits } = await import("../../src/lib/flow/bridge.js");
    const { getFlowJob } = await import("../../src/lib/db/repos/flowRepo.js");

    const before = await refreshFlowCredits();
    const job = await enqueueFlowJob({
      prompt: "Kelima orang di foto bergerak makan dan mengucapkan hidup jokowi, kamera maju perlahan.",
      model: "omni-flash",
      duration: 4,
      aspect: "16:9",
      imagePath,
    });
    expect(job.mode).toBe("i2v");

    let current = job;
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      current = await getFlowJob(job.id);
      if (current.status === "completed" || current.status === "failed") break;
    }

    expect(current.error || "").toBe("");
    expect(current.status).toBe("completed");
    expect(current.projectId).toBeTruthy();

    // mediaPath is stored relative to the media store, not to the test cwd.
    const { resolveVideoAssetPath } = await import("../../src/lib/media/videoStore.js");
    const onDisk = resolveVideoAssetPath(current.mediaPath);
    expect(existsSync(onDisk)).toBe(true);
    expect(statSync(onDisk).size).toBeGreaterThan(100_000);

    const after = await refreshFlowCredits();
    expect(before.balance - after.balance).toBe(current.creditCost);
    console.log("[flow] i2v rendered", onDisk, `project ${current.projectId}`, `${before.balance} -> ${after.balance}`);
  }, 25 * 60 * 1000);
});
