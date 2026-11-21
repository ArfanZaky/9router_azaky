import { describe, expect, it } from "vitest";

import flowProvider, { FLOW_IMAGE_MODELS, FLOW_VIDEO_MODELS, flowCliModel, flowCreditCost, isFlowModelRetired } from "../../open-sse/providers/registry/flow.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getVideoAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { flowJobToResponse, validateFlowRequest } from "../../src/lib/flow/bridge.js";
import { deleteFlowJob } from "../../src/lib/db/repos/flowRepo.js";

describe("flow provider registration", () => {
  it("is reachable through PROVIDER_MEDIA with video and image configs", () => {
    expect(flowProvider.id).toBe("flow");
    expect(PROVIDER_MEDIA.flow?.videoConfig?.models).toEqual(FLOW_VIDEO_MODELS);
    expect(PROVIDER_MEDIA.flow?.imageConfig?.models).toEqual(FLOW_IMAGE_MODELS);
    expect(PROVIDER_MEDIA.flow.videoConfig.baseUrl).toBe("flow://local-bridge");
  });

  it("exposes its six video models and four image models to the model matrix", () => {
    const videoModels = PROVIDER_MODELS.flow.filter((m) => m.kind === "video").map((m) => m.id).sort();
    expect(videoModels).toEqual(["omni-1.2-flash", "omni-flash", "veo-fast", "veo-lite", "veo-lite-lp", "veo-quality"]);
    const imageModels = PROVIDER_MODELS.flow.filter((m) => m.kind === "image").map((m) => m.id).sort();
    expect(imageModels).toEqual(["imagen4", "nano-pro", "nano2", "nano2-lite"]);
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

// Prices depend on the day: Omni Flash 1.1 retires on 2026-12-05 and 1.2 is
// billed per second from then on. Every assertion pins its own date.
const BEFORE = new Date("2026-11-21T12:00:00Z");
const AFTER = new Date("2026-12-05T00:00:00Z");

describe("flow credit table", () => {
  // support.google.com/flow/answer/16526234: priced per clip, flat for Veo.
  it("prices omni-flash at the 1.1 table before the retirement", () => {
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: "360p", at: BEFORE })).toBe(4);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "360p", at: BEFORE })).toBe(7);
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: "720p", at: BEFORE })).toBe(7);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "720p", at: BEFORE })).toBe(15);
  });

  it("prices omni-flash per second (1.2) from the retirement day", () => {
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: "360p", at: AFTER })).toBe(4);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "360p", at: AFTER })).toBe(10);
    expect(flowCreditCost("omni-flash", { duration: 4, resolution: "720p", at: AFTER })).toBe(12);
    expect(flowCreditCost("omni-flash", { duration: 10, resolution: "720p", at: AFTER })).toBe(30);
  });

  it("keeps Veo flat: 4s and 8s cost the same", () => {
    expect(flowCreditCost("veo-lite", { duration: 4, at: BEFORE })).toBe(10);
    expect(flowCreditCost("veo-lite", { duration: 8, at: AFTER })).toBe(10);
    expect(flowCreditCost("veo-fast", { duration: 8, at: BEFORE })).toBe(20);
    expect(flowCreditCost("veo-quality", { duration: 8, at: BEFORE })).toBe(100);
  });

  // gflow 0.103: `omni-flash` is Omni Flash 1.1 (retiring), `omni-1.2-flash` is 1.2.
  it("sends omni-flash to gflow as omni-1.2-flash from the retirement day", () => {
    expect(flowCliModel("omni-flash", { at: BEFORE })).toBe("omni-flash");
    expect(flowCliModel("omni-flash", { at: AFTER })).toBe("omni-1.2-flash");
    expect(flowCliModel("omni-1.2-flash", { at: BEFORE })).toBe("omni-1.2-flash");
    expect(flowCliModel("veo-lite", { at: AFTER })).toBe("veo-lite");
  });

  it("prices Omni Flash 1.2 per second, with dearer seconds past 10s", () => {
    expect(flowCreditCost("omni-1.2-flash", { duration: 3, resolution: "720p", at: BEFORE })).toBe(9);
    expect(flowCreditCost("omni-1.2-flash", { duration: 10, resolution: "720p", at: BEFORE })).toBe(30);
    expect(flowCreditCost("omni-1.2-flash", { duration: 15, resolution: "720p", at: BEFORE })).toBe(60);
    expect(flowCreditCost("omni-1.2-flash", { duration: 15, resolution: "360p", at: BEFORE })).toBe(20);
    expect(flowCreditCost("omni-1.2-flash", { duration: 2, resolution: "720p", at: BEFORE })).toBeNull();
  });

  it("retires Veo 3.1 Fast and Quality on 2026-12-05, not Lite or Omni", () => {
    expect(isFlowModelRetired("veo-fast", { at: BEFORE })).toBe(false);
    expect(isFlowModelRetired("veo-fast", { at: AFTER })).toBe(true);
    expect(isFlowModelRetired("veo-quality", { at: AFTER })).toBe(true);
    expect(isFlowModelRetired("veo-lite", { at: AFTER })).toBe(false);
    expect(isFlowModelRetired("omni-flash", { at: AFTER })).toBe(false);
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
    const req = validateFlowRequest({ model: "omni-flash", prompt: "a cat", duration: 10 }, { now: BEFORE });
    expect(req).toMatchObject({ mode: "t2v", aspect: "16:9", resolution: "720p", creditCost: 15 });
    const later = validateFlowRequest({ model: "omni-flash", prompt: "a cat", duration: 10 }, { now: AFTER });
    expect(later.creditCost).toBe(30);
  });

  it("refuses a retired model before any submit", () => {
    expect(() => validateFlowRequest({ model: "veo-fast", prompt: "x", duration: 8 }, { now: AFTER })).toThrow(/retired/);
    expect(() => validateFlowRequest({ model: "veo-quality", prompt: "x", duration: 8 }, { now: AFTER })).toThrow(/retired/);
  });

  it("refuses a resolution this host cannot select, before any spend", () => {
    expect(() => validateFlowRequest({ prompt: "x", model: "omni-flash", duration: 10, resolution: "360p" })).toThrow(
      /renders 720p only/
    );
  });

  it("rejects settings Flow itself would refuse, before any submit", () => {
    expect(() => validateFlowRequest({ model: "nope", prompt: "x" })).toThrow(/Unknown Flow model/);
    expect(() => validateFlowRequest({ model: "veo-lite", prompt: "x", duration: 10 })).toThrow(/does not offer 10s/);
    expect(() => validateFlowRequest({ model: "veo-lite", prompt: "x", duration: 8, resolution: "720p" })).toThrow(/no resolution option/);
    expect(() => validateFlowRequest({ model: "omni-flash", prompt: "" })).toThrow(/prompt is required/);
    expect(() => validateFlowRequest({ model: "omni-flash", prompt: "x", image: "frame.png" })).toThrow(/imagePath/);
  });

  it("marks i2v when an image is supplied", () => {
    const req = validateFlowRequest({ model: "veo-fast", prompt: "push in", duration: 8, imagePath: "tmp/frame.png" }, { now: BEFORE });
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

  it("renders a dry-run image through handleImageGenerationCore", async () => {
    const saved = process.env.FLOW_BRIDGE_DRYRUN;
    process.env.FLOW_BRIDGE_DRYRUN = "1";
    try {
      expect(getImageAdapter("flow")).toBeTruthy();
      const res = await handleImageGenerationCore({
        body: { model: "flow/nano2", prompt: "cyberpunk alley", size: "1792x1024" },
        modelInfo: { provider: "flow", model: "nano2" },
        credentials: null,
      });
      expect(res.success).toBe(true);
      const payload = await res.response.json();
      expect(payload.data?.[0]?.url).toMatch(/^\/api\/flow\/images\//);
    } finally {
      if (saved === undefined) delete process.env.FLOW_BRIDGE_DRYRUN;
      else process.env.FLOW_BRIDGE_DRYRUN = saved;
    }
  });
});
