import { afterAll, describe, expect, it } from "vitest";

import { createFlowJob, failStaleFlowJobs, getFlowJob, updateFlowJob, deleteFlowJob } from "../../src/lib/db/repos/flowRepo.js";

const created = [];

async function seed(status, startedAt) {
  const job = await createFlowJob({
    id: `test-stale-${Math.random().toString(36).slice(2)}`,
    model: "omni-flash",
    prompt: "x",
    duration: 4,
    aspect: "16:9",
    creditCost: 0,
  });
  await updateFlowJob(job.id, { status, startedAt });
  created.push(job.id);
  return job.id;
}

afterAll(async () => {
  for (const id of created) await deleteFlowJob(id).catch(() => {});
});

describe("stale flow jobs", () => {
  // A killed process leaves the row in 'running'. It must be reported as failed
  // (the clip may already exist in Flow) and never silently deleted.
  it("fails a running job whose worker is gone", async () => {
    const old = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const id = await seed("running", old);
    const changed = await failStaleFlowJobs({ olderThanMinutes: 45 });
    expect(changed).toBeGreaterThan(0);
    const job = await getFlowJob(id);
    expect(job.status).toBe("failed");
    expect(job.step).toBe("stale");
    expect(job.error).toMatch(/spends credits twice/);
  });

  it("leaves a fresh running job alone", async () => {
    const id = await seed("running", new Date().toISOString());
    await failStaleFlowJobs({ olderThanMinutes: 45 });
    expect((await getFlowJob(id)).status).toBe("running");
  });

  it("does not touch queued jobs of any age", async () => {
    const id = await seed("queued", new Date(Date.now() - 90 * 60 * 1000).toISOString());
    await failStaleFlowJobs({ olderThanMinutes: 45 });
    expect((await getFlowJob(id)).status).toBe("queued");
  });
});
