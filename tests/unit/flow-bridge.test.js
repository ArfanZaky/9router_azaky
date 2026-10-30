import { describe, expect, it } from "vitest";

import flowProvider, { FLOW_VIDEO_MODELS, flowCreditCost } from "../../open-sse/providers/registry/flow.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getVideoAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import { flowJobToResponse, validateFlowRequest } from "../../src/lib/flow/bridge.js";
import { deleteFlowJob } from "../../src/lib/db/repos/flowRepo.js";

describe("flow provider registration", () => {
  it("is reachable through PROVIDER_MEDIA with a video config", () => {
    expect(flowProvider.id).toBe("flow");
    expect(PROVIDER_MEDIA.flow?.videoConfig?.models).toEqual(FLOW_VIDEO_MODELS);
    expect(PROVIDER_MEDIA.flow.videoConfig.baseUrl).toBe("flow://local-bridge");
  });

  it("exposes its five video models to the model matrix", () => {
    const models = PROVIDER_MODELS.flow.map((m) => m.id).sort();
    expect(models).toEqual(["omni-flash", "veo-fast", "veo-lite", "veo-lite-lp", "veo-quality"]);
    for (const model of PROVIDER_MODELS.flow) expect(model.kind).toBe("video");
  });

  // A URL plan would be fetched over the network; Flow has no reachable host,
  // so the adapter must answer in-process instead.
  it("has an in-process adapter, never a Google URL", async () => {
    const adapter = getVideoAdapter("flow");
    expect(adapter).toBeTruthy();

    const create = await adapter.buildRequest({
      config: PROVIDER_MEDIA.flow.videoConfig,
      action: "generations",
      rawBody: "{}",
      contentType: "application/json",
    });
    expect(typeof create.handle).toBe("function");
    expect(create.url).toBeUndefined();
    expect(JSON.stringify(create)).not.toMatch(/google\.com/);

    const poll = await adapter.buildRequest({ config: PROVIDER_MEDIA.flow.videoConfig, requestId: "abc-123" });
    expect(typeof poll.handle).toBe("function");
    expect(poll.url).toBeUndefined();
  });
});

describe("flow credit table", () => {
  // support.google.com/flow/answer/16526234: priced per clip, flat for Veo.
  it("prices omni-flash per duration and resolution", () => {
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: "360p" })).toBe(4);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "360p" })).toBe(7);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "720p" })).toBe(15);
  });

  it("keeps Veo flat: 4s and 8s cost the same", () => {
    expect(flowCreditCost("veo-lite", { duration: 4 })).toBe(10);
    expect(flowCreditCost("veo-lite", { duration: 8 })).toBe(10);
    expect(flowCreditCost("veo-fast", { duration: 8 })).toBe(20);
    expect(flowCreditCost("veo-quality", { duration: 8 })).toBe(100);
  });

  it("returns null for combinations the model does not offer", () => {
    expect(flowCreditCost("veo-quality", { duration: 4 })).toBeNull();
    expect(flowCreditCost("veo-fast", { duration: 10 })).toBeNull();
    expect(flowCreditCost("nope", { duration: 8 })).toBeNull();
  });
});

describe("flow request validation (pre-submit, no spend)", () => {
  // The agent-only Flow host has no resolution row: it always renders 720p, so
  // the price must be the 720p one even when nobody asked for a resolution.
  it("pins omni-flash to the resolution this host actually renders", () => {
    const req = validateFlowRequest({ model: "omni-flash", prompt: "a cat", duration: 10 });
    expect(req).toMatchObject({ mode: "t2v", aspect: "16:9", resolution: "720p", creditCost: 15 });
  });

  it("refuses a resolution this host cannot select, before any spend", () => {
    expect(() => validateFlowRequest({ prompt: "x", model: "omni-flash", duration: 10, resolution: "360p" })).toThrow(
      /renders 720p only/
    );
  });

  it("rejects settings Flow itself would refuse, before any submit", () => {
    expect(() => validateFlowRequest({ model: "nope", prompt: "x" })).toThrow(/Unknown Flow model/);
    expect(() => validateFlowRequest({ model: "veo-fast", prompt: "x", duration: 10 })).toThrow(/does not offer 10s/);
    expect(() => validateFlowRequest({ model: "veo-lite", prompt: "x", duration: 8, resolution: "720p" })).toThrow(/no resolution option/);
    expect(() => validateFlowRequest({ model: "omni-flash", prompt: "" })).toThrow(/prompt is required/);
    expect(() => validateFlowRequest({ model: "omni-flash", prompt: "x", image: "frame.png" })).toThrow(/imagePath/);
  });

  it("marks i2v when an image is supplied", () => {
    const req = validateFlowRequest({ model: "veo-fast", prompt: "push in", duration: 8, imagePath: "tmp/frame.png" });
    expect(req.mode).toBe("i2v");
    expect(req.creditCost).toBe(20);
  });
});

describe("flow job → async-job response", () => {
  const job = { id: "j1", model: "veo-fast", mode: "t2v", status: "running", step: "uploading", duration: 8, aspect: "16:9", creditCost: 20, dryRun: false, createdAt: "2026-10-30T00:00:00Z" };

  it("reports queued/running as processing", () => {
    expect(flowJobToResponse({ ...job, status: "queued" }).status).toBe("processing");
    expect(flowJobToResponse(job).status).toBe("processing");
  });

  it("surfaces the video url only when there is one, and flags dry runs", () => {
    expect(flowJobToResponse(job).video).toBeUndefined();
    const done = flowJobToResponse({ ...job, status: "completed", mediaPath: "/media/flow/j1.mp4", dryRun: true });
    expect(done.status).toBe("completed");
    expect(done.video).toEqual({ url: "/media/flow/j1.mp4" });
    expect(done.dry_run).toBe(true);
  });

  it("reports failures with the upstream error text", () => {
    const failed = flowJobToResponse({ ...job, status: "failed", error: "target crashed" });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("target crashed");
  });
});

// The HTTP surface without the server: handleVideoProxyCore is what the /v1/videos
// route calls, so this proves the flow provider is routed end to end in-process.
describe("flow through the video handler (dry run, no spend)", () => {
  it("creates and polls a job through handleVideoProxyCore", async () => {
    const saved = process.env.FLOW_BRIDGE_DRYRUN;
    process.env.FLOW_BRIDGE_DRYRUN = "1";
    let id = null;
    try {
      const create = await handleVideoProxyCore({
        provider: "flow",
        action: "generations",
        contentType: "application/json",
        rawBody: JSON.stringify({ model: "omni-flash", prompt: "core route", duration: 4 }),
      });
      expect(create.success).toBe(true);
      expect(create.response.status).toBe(202);

      const created = await create.response.json();
      id = created.request_id;
      expect(created).toMatchObject({ status: "processing", credit_cost: 7, resolution: "720p" });

      let polled = created;
      for (let i = 0; i < 80 && polled.status !== "completed"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const poll = await handleVideoProxyCore({ provider: "flow", requestId: id });
        polled = await poll.response.json();
      }
      expect(polled.status).toBe("completed");
      expect(polled.dry_run).toBe(true);
    } finally {
      if (id) await deleteFlowJob(id);
      if (saved === undefined) delete process.env.FLOW_BRIDGE_DRYRUN;
      else process.env.FLOW_BRIDGE_DRYRUN = saved;
    }
  });
});
