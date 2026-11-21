import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FlowRequestError, generateFlowImage } from "../../src/lib/flow/bridge.js";
import { describeImageFailure, renderFlowImage } from "../../src/lib/flow/driver.js";
import flowImageAdapter from "../../open-sse/handlers/imageProviders/flow.js";

// Dry-run only: nothing here launches a browser or touches Flow's image quota.
let previousDryRun;
beforeAll(() => {
  previousDryRun = process.env.FLOW_BRIDGE_DRYRUN;
  process.env.FLOW_BRIDGE_DRYRUN = "1";
});
afterAll(() => {
  if (previousDryRun === undefined) delete process.env.FLOW_BRIDGE_DRYRUN;
  else process.env.FLOW_BRIDGE_DRYRUN = previousDryRun;
});

describe("generateFlowImage (dry run)", () => {
  it("returns one entry per requested image and keeps the first at the top level", async () => {
    const result = await generateFlowImage({ prompt: "a red bicycle", model: "nano2", count: 3 });
    expect(result.images).toHaveLength(3);
    expect(new Set(result.images.map((i) => i.id)).size).toBe(3);
    expect(result.id).toBe(result.images[0].id);
    expect(result.url).toBe(`/api/flow/images/${result.id}`);
  });

  it("accepts OpenAI's n as the count", async () => {
    const result = await generateFlowImage({ prompt: "x", model: "nano2", n: 2 });
    expect(result.images).toHaveLength(2);
  });

  it("refuses a count outside 1-4 before anything runs", async () => {
    await expect(generateFlowImage({ prompt: "x", count: 5 })).rejects.toBeInstanceOf(FlowRequestError);
    await expect(generateFlowImage({ prompt: "x", count: 0 })).rejects.toThrow(/1 to 4/);
  });

  it("refuses more references than the model takes", async () => {
    const refPaths = ["a.png", "b.png", "c.png", "d.png"];
    await expect(generateFlowImage({ prompt: "x", model: "nano2-lite" }, { refPaths })).rejects.toThrow(/at most 3/);
  });

  // `body` is what a remote /v1/images client sends; resolved local paths must
  // only come from the trusted second argument.
  it("ignores imagePaths smuggled in the request body", async () => {
    const imagePaths = Array.from({ length: 20 }, (_, i) => `C:/secret-${i}.png`);
    const result = await generateFlowImage({ prompt: "x", model: "nano2-lite", imagePaths });
    expect(result.images).toHaveLength(1);
  });
});

describe("flow image adapter", () => {
  it("maps every generated image into OpenAI's data array", async () => {
    const out = await flowImageAdapter.executeViaExecutor("nano2", { prompt: "x", n: 2 });
    expect(out.data).toHaveLength(2);
    expect(out.data[0].url).toMatch(/^\/api\/flow\/images\//);
  });
});

describe("gflow image driver", () => {
  it("refuses a real render inside a test run", async () => {
    await expect(renderFlowImage({ prompt: "x" })).rejects.toThrow(/Refusing to render Flow inside a test run/);
  });

  it("explains the agent-only composer failure instead of dumping CLI output", () => {
    const stdout = JSON.stringify({
      status: "fail",
      error: { class: "FlowHostMigratedError", type: "https://gflow-cli.dev/errors/flow-host-migrated", exit_code: 36 },
    });
    expect(describeImageFailure({ code: 36, stdout, stderr: "" }, "x.log")).toMatch(/agent-only/);
  });

  it("falls back to the problem detail for other failures", () => {
    const stdout = JSON.stringify({ status: "fail", error: { detail: "profile is locked" } });
    expect(describeImageFailure({ code: 11, stdout, stderr: "" }, "x.log")).toMatch(/exited 11: profile is locked/);
  });
});
