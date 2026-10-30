// Google Flow bridge: the only owner of the Flow browser session.
//
// Flow cannot be called over HTTP (reCAPTCHA-gated submit), so 9Router drives
// the real web app with Playwright on the profile that is already signed in.
// Everything funnels through here because:
//   * Flow allows one generation at a time per account — the queue is serial;
//   * two Chromium instances on one profile corrupt it (`ProfileLockedError`),
//     so this module is the single owner and `gflow` CLI stays read-only while
//     it runs;
//   * a job must survive a poll, or the video URL is lost — jobs live in
//     `flowJobs` (src/lib/db/repos/flowRepo.js), not in memory.
//
// P0: queue, validation, credit gate, job lifecycle. The browser driver lives in
// ./driver.js and is wired in P1; until then a job fails with an explicit
// "driver not available" instead of pretending to render.
import {
  FLOW_VIDEO_MODELS,
  flowCreditCost,
} from "../../../open-sse/providers/registry/flow.js";
import {
  addFlowCreditSnapshot,
  claimNextFlowJob,
  createFlowJob,
  getFlowJob,
  getLatestFlowCreditSnapshot,
  failStaleFlowJobs,
  sumFlowCreditsSince,
  updateFlowJob,
} from "../db/repos/flowRepo.js";

const CONCURRENCY = 1;
const DRY_RUN = () => process.env.FLOW_BRIDGE_DRYRUN === "1";

// The agent-only flow.google.com composer has no resolution row, so Flow renders
// its own default (720p for omni-flash) no matter what was asked. Prices are
// pinned to that default because it is what the account is actually charged.
export const hostResolution = () => process.env.FLOW_HOST_RESOLUTION || "720p";

export class FlowRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "FlowRequestError";
    this.status = status;
  }
}

/** Validate a generation request against the registry table, before any spend. */
export function validateFlowRequest(body = {}) {
  const mode = body.mode === "i2v" || body.imagePath || body.image ? "i2v" : "t2v";
  const model = String(body.model || "omni-flash");
  const spec = FLOW_VIDEO_MODELS[model];
  if (!spec) throw new FlowRequestError(`Unknown Flow model '${model}'`);

  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new FlowRequestError("prompt is required");
  if (prompt.length > 4000) throw new FlowRequestError("prompt is longer than 4000 characters");

  const duration = Number(body.duration ?? spec.durations[0]);
  if (!spec.durations.includes(duration)) {
    throw new FlowRequestError(`${model} does not offer ${duration}s (allowed: ${spec.durations.join(", ")})`);
  }

  const aspect = String(body.aspect_ratio || body.aspect || spec.aspects[0]);
  if (!spec.aspects.includes(aspect)) {
    throw new FlowRequestError(`${model} does not offer aspect ${aspect} (allowed: ${spec.aspects.join(", ")})`);
  }

  // Only omni-flash exposes a resolution switch, and on this host even that
  // switch is unreachable (the agent-only composer has no resolution row), so
  // Flow always renders its own default. Charging for a resolution the render
  // will not use would make the credit table lie: pin the host default and
  // refuse anything else instead.
  const rawResolution = body.resolution ? String(body.resolution) : "";
  let resolution = null;
  if (spec.resolutions.length) {
    const hostDefault = hostResolution();
    if (rawResolution && rawResolution !== hostDefault) {
      throw new FlowRequestError(
        `${model} on this Flow host renders ${hostDefault} only; requested ${rawResolution} cannot be selected (no credits spent)`
      );
    }
    resolution = hostDefault;
  } else if (rawResolution) {
    throw new FlowRequestError(`${model} has no resolution option; drop 'resolution'`);
  }

  if (mode === "i2v" && !body.imagePath) {
    throw new FlowRequestError("i2v needs a local imagePath (upload the frame from the Flow page first)");
  }

  const creditCost = flowCreditCost(model, { duration, resolution });
  if (creditCost === null) throw new FlowRequestError(`${model} has no price for ${duration}s ${resolution || ""}`.trim());

  return { mode, model, prompt, duration, aspect, resolution, imagePath: body.imagePath || null, creditCost };
}

/** Refuse a job the account cannot afford — Flow would fail mid-render otherwise. */
export async function assertAffordable(creditCost) {
  if (DRY_RUN() || creditCost === 0) return;
  const snapshot = await getLatestFlowCreditSnapshot();
  if (!snapshot) {
    throw new FlowRequestError(
      "Balance unknown: refresh Flow credits before spending. Submit is blocked because a job can cost more than the account holds.",
      409
    );
  }
  if (snapshot.balance < creditCost) {
    throw new FlowRequestError(`Insufficient Flow credits: need ${creditCost}, last known balance ${snapshot.balance}`, 402);
  }
}

/** Credits this install may spend per local day. 0 disables the cap. */
export const dailyBudget = () => Number(process.env.FLOW_DAILY_BUDGET_CREDITS) || 0;

/** Start of the current local day, in the DB's ISO format. */
function localDayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

/**
 * Optional spend cap. Flow will happily render until the balance is gone, so a
 * loop or a runaway client can burn a whole account in one afternoon; this
 * refuses the job before submit instead. Off by default (0).
 */
export async function assertWithinDailyBudget(creditCost) {
  const cap = dailyBudget();
  if (DRY_RUN() || !cap || creditCost === 0) return { cap: 0, spent: 0 };
  const { credits } = await sumFlowCreditsSince(localDayStart());
  if (credits + creditCost > cap) {
    throw new FlowRequestError(
      `Daily Flow budget reached: ${credits} of ${cap} credits already spent today, this clip needs ${creditCost}. Raise FLOW_DAILY_BUDGET_CREDITS to allow it.`,
      429
    );
  }
  return { cap, spent: credits };
}

/** Balance, today's spend and the cap, for the dashboard header. */
export async function flowBudgetState() {
  const snap = await getLatestFlowCreditSnapshot();
  const today = await sumFlowCreditsSince(localDayStart());
  return { balance: snap?.balance ?? null, balanceAt: snap?.createdAt ?? null, spentToday: today.credits, jobsToday: today.jobs, dailyCap: dailyBudget() };
}

export async function enqueueFlowJob(input = {}) {
  const req = validateFlowRequest(input);
  await assertAffordable(req.creditCost);
  await assertWithinDailyBudget(req.creditCost);
  const job = await createFlowJob({ ...req, projectId: input.projectId || null, dryRun: DRY_RUN() });
  pump();
  return job;
}

/**
 * Read the balance Flow shows in its own account menu and persist it. The credit
 * gate reads only what is stored here, so an unknown balance blocks submit
 * instead of risking a render the account cannot pay for.
 */
export async function refreshFlowCredits() {
  const { readFlowCredits } = await import("./driver.js");
  const balance = await readFlowCredits();
  return addFlowCreditSnapshot({ balance, source: "driver" });
}

/**
 * Copy the finished mp4 into the shared video store so /api/video-prompt/media
 * can stream it with range support like every other generated video. Falls back
 * to the driver's own path when the copy fails: the clip still exists.
 */
async function persistVideo(jobId, srcPath) {
  if (!srcPath) return null;
  try {
    const [{ writeVideoAssetFile }, { readFileSync }] = await Promise.all([
      import("../media/videoStore.js"),
      import("node:fs"),
    ]);
    return writeVideoAssetFile({ id: jobId, buffer: readFileSync(srcPath) }).rel;
  } catch (error) {
    console.error("[FLOW] could not move video into media store:", error?.message || error);
    return srcPath;
  }
}

/** Serial worker. Never throws to the caller; failures land on the job row. */
async function runJob(job) {
  const running = await updateFlowJob(job.id, { status: "running", step: "starting", startedAt: new Date().toISOString() });

  if (running.dryRun) {
    return updateFlowJob(job.id, {
      status: "completed",
      step: "dry-run",
      error: null,
      finishedAt: new Date().toISOString(),
    });
  }

  let driver;
  try {
    driver = await import("./driver.js");
  } catch {
    return updateFlowJob(job.id, {
      status: "failed",
      step: "driver-missing",
      error: "Flow browser driver is not installed yet (P1). Nothing was submitted; no credits spent.",
      finishedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await driver.renderFlowJob(running, {
      onStep: (step) => {
        updateFlowJob(job.id, { step: String(step).slice(0, 200) }).catch(() => {});
      },
    });
    const done = await updateFlowJob(job.id, {
      status: "completed",
      step: "done",
      error: null,
      mediaPath: await persistVideo(job.id, result?.mediaPath),
      sourceUrl: result?.sourceUrl || null,
      finishedAt: new Date().toISOString(),
    });
    // Awaited, not fire-and-forget: the balance read opens the same profile the
    // next queued job is about to drive, so it must not overlap it. A failure
    // here is cosmetic — the render already succeeded.
    try {
      await refreshFlowCredits();
    } catch (error) {
      console.error("[FLOW] credit refresh after job failed:", error?.message || error);
    }
    return done;
  } catch (error) {
    return updateFlowJob(job.id, {
      status: "failed",
      step: "error",
      error: String(error?.message || error).slice(0, 1000),
      finishedAt: new Date().toISOString(),
    });
  }
}

let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    // A killed server leaves rows in 'running' forever; clear them before
    // claiming work so the queue reflects reality.
    await failStaleFlowJobs().catch(() => {});
    let active = 0;
    while (active < CONCURRENCY) {
      const job = await claimNextFlowJob();
      if (!job) break;
      active += 1;
      await runJob(job);
      active -= 1;
    }
  } catch (error) {
    console.error("[FLOW] queue pump error:", error?.message || error);
  } finally {
    pumping = false;
  }
}

/** Map a stored job onto the async-job shape /v1/videos callers already poll. */
export function flowJobToResponse(job) {
  if (!job) return null;
  const status = job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "processing";
  return {
    request_id: job.id,
    id: job.id,
    status,
    model: job.model,
    mode: job.mode,
    step: job.step,
    duration: job.duration,
    aspect_ratio: job.aspect,
    resolution: job.resolution,
    credit_cost: job.creditCost,
    dry_run: job.dryRun,
    video: job.sourceUrl || job.mediaPath ? { url: job.sourceUrl || job.mediaPath } : undefined,
    error: job.error || undefined,
    created_at: job.createdAt,
    finished_at: job.finishedAt || undefined,
  };
}

/** Model specs with the host-pinned price for every duration, for the dashboard. */
export function flowPriceTable() {
  const host = hostResolution();
  const models = Object.entries(FLOW_VIDEO_MODELS).map(([id, spec]) => {
    // Only omni-flash exposes a resolution switch, and this host pins it, so a
    // model with no resolution row is displayed without one instead of offering
    // a choice that cannot be selected.
    const resolutions = spec.resolutions.length ? [host] : [null];
    return {
      id,
      name: spec.name,
      durations: spec.durations,
      aspects: spec.aspects,
      resolutions,
      maxRefs: spec.maxRefs,
      costs: resolutions.flatMap((resolution) =>
        spec.durations.map((duration) => {
          const credits = flowCreditCost(id, { duration, resolution });
          return { duration, resolution, credits, perSecond: credits === null ? null : Number((credits / duration).toFixed(2)) };
        })
      ),
    };
  });
  return { hostResolution: host, models };
}

export async function getFlowJobResponse(id) {
  return flowJobToResponse(await getFlowJob(id));
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

/** Cheap guard so a poll on any other provider never touches the Flow table. */
export async function isFlowJobId(id) {
  const raw = String(id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return false;
  return Boolean(await getFlowJob(raw));
}

/**
 * Entry point for the `flow` video adapter. Same process as the server, so this
 * replaces the fetch cycle videoCore normally runs: no port, no second auth
 * layer. Never throws — videoCore only understands a Response.
 */
export async function handleFlowRequest({ requestId = null, rawBody = null } = {}) {
  try {
    if (requestId) {
      const job = await getFlowJobResponse(requestId);
      return job ? jsonResponse(job) : jsonResponse({ error: "Flow job not found" }, 404);
    }

    let body = {};
    if (rawBody) {
      const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
      if (text.trim()) {
        try {
          body = JSON.parse(text);
        } catch {
          return jsonResponse({ error: "Flow accepts JSON bodies only; nothing was submitted" }, 400);
        }
      }
    }

    const job = await enqueueFlowJob(body);
    return jsonResponse(flowJobToResponse(job), 202);
  } catch (error) {
    if (error instanceof FlowRequestError) return jsonResponse({ error: error.message }, error.status);
    return jsonResponse({ error: error?.message || "Flow request failed" }, 500);
  }
}
