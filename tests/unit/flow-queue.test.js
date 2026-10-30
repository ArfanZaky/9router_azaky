import { describe, expect, it } from "vitest";

process.env.FLOW_BRIDGE_DRYRUN = "1";
const bridge = await import("../../src/lib/flow/bridge.js");
const repo = await import("../../src/lib/db/repos/flowRepo.js");

const created = [];
const waitFor = async (id, statuses, ms = 3000) => {
  const until = Date.now() + ms;
  let job;
  while (Date.now() < until) {
    job = await repo.getFlowJob(id);
    if (job && statuses.includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  return job;
};

describe("flow bridge queue (no credits spent)", () => {
  it("queues, completes and persists a dry-run job", async () => {
    const job = await bridge.enqueueFlowJob({ model: "omni-flash", prompt: "tmp flow e2e dry", duration: 4 });
    created.push(job.id);
    expect(job.status).toBe("queued");
    expect(job.creditCost).toBe(7);
    expect(job.dryRun).toBe(true);

    const done = await waitFor(job.id, ["completed", "failed"]);
    expect(done.status).toBe("completed");
    expect(done.step).toBe("dry-run");
    expect(done.mediaPath).toBeNull();

    const res = await bridge.getFlowJobResponse(job.id);
    expect(res).toMatchObject({ request_id: job.id, status: "completed", dry_run: true, credit_cost: 7 });
    expect(res.video).toBeUndefined();
  });

  it("blocks a paid job the last known balance cannot cover", async () => {
    process.env.FLOW_BRIDGE_DRYRUN = "0";
    await repo.addFlowCreditSnapshot({ balance: 5, source: "test" });
    await expect(bridge.enqueueFlowJob({ model: "veo-fast", prompt: "x", duration: 8 })).rejects.toThrow(/Insufficient Flow credits/);
  });

  it("fails loudly (no submit) unless a real render is opted in", async () => {
    await repo.addFlowCreditSnapshot({ balance: 500, source: "test" });
    const job = await bridge.enqueueFlowJob({ model: "veo-fast", prompt: "x", duration: 8 });
    created.push(job.id);
    const done = await waitFor(job.id, ["completed", "failed"], 15000);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/Refusing to render Flow inside a test run|spawn failed/);
    expect(done.mediaPath).toBeNull();
  });

  it("keeps serial order: one running job at a time", async () => {
    process.env.FLOW_BRIDGE_DRYRUN = "1";
    const a = await bridge.enqueueFlowJob({ model: "omni-flash", prompt: "order a", duration: 4 });
    const b = await bridge.enqueueFlowJob({ model: "omni-flash", prompt: "order b", duration: 4 });
    created.push(a.id, b.id);
    const [da, db] = await Promise.all([waitFor(a.id, ["completed", "failed"]), waitFor(b.id, ["completed", "failed"])]);
    expect(da.status).toBe("completed");
    expect(db.status).toBe("completed");
    expect(new Date(db.startedAt).getTime()).toBeGreaterThanOrEqual(new Date(da.finishedAt).getTime());
  });

  it("answers the adapter in-process: create 202, poll completed", async () => {
    process.env.FLOW_BRIDGE_DRYRUN = "1";
    const create = await bridge.handleFlowRequest({
      action: "generations",
      contentType: "application/json",
      rawBody: JSON.stringify({ model: "omni-flash", prompt: "inline t2v", duration: 6 }),
    });
    expect(create.status).toBe(202);
    const payload = await create.json();
    expect(payload.status).toBe("processing");
    expect(payload.credit_cost).toBe(10);
    created.push(payload.request_id);

    const done = await waitFor(payload.request_id, ["completed", "failed"]);
    expect(done.status).toBe("completed");

    const poll = await bridge.handleFlowRequest({ requestId: payload.request_id });
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({ status: "completed", dry_run: true });
  });

  it("rejects a malformed body instead of submitting", async () => {
    const bad = await bridge.handleFlowRequest({ rawBody: "not json" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/JSON bodies only/);
  });

  it("404s an unknown job id", async () => {
    expect((await bridge.handleFlowRequest({ requestId: "does-not-exist" })).status).toBe(404);
  });

  it("cleans up its own rows", async () => {
    for (const id of created) await repo.deleteFlowJob(id);
    for (const id of created) expect(await repo.getFlowJob(id)).toBeNull();
    expect(await repo.deleteFlowCreditSnapshotsBySource("test")).toBeGreaterThan(0);
  });
});