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
  FLOW_IMAGE_MODELS,
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
  getFlowStatsSummary,
} from "../db/repos/flowRepo.js";
import { getSettings, updateSettings } from "../db/repos/settingsRepo.js";

const CONCURRENCY = 1;
const DRY_RUN = () => process.env.FLOW_BRIDGE_DRYRUN === "1";

const DEFAULT_FLOW_CONFIG = {
  activeProfile: "",
  rotationStrategy: "active_only", // "active_only" | "fallback" | "round_robin"
  dailyBudgetCredits: 0,
  hostResolution: "720p",
  headless: false,
  channel: "chrome",
  renderTimeoutMinutes: 15,
  composerTimeoutMinutes: 20,
  creditTimeoutMinutes: 3,
  defaultProjectId: "",
  dryRun: false,
};

let roundRobinIndex = 0;

/** Read merged Flow configuration (env overrides DB settings when explicitly set). */
export async function getFlowConfig() {
  let stored = {};
  try {
    const settings = await getSettings();
    stored = settings?.flowConfig || {};
  } catch {
    stored = {};
  }
  const merged = { ...DEFAULT_FLOW_CONFIG, ...stored };
  return {
    activeProfile: process.env.FLOW_PROFILE || merged.activeProfile || "",
    rotationStrategy: merged.rotationStrategy || "active_only",
    dailyBudgetCredits:
      process.env.FLOW_DAILY_BUDGET_CREDITS !== undefined
        ? Number(process.env.FLOW_DAILY_BUDGET_CREDITS) || 0
        : Number(merged.dailyBudgetCredits) || 0,
    hostResolution: process.env.FLOW_HOST_RESOLUTION || merged.hostResolution || "720p",
    headless:
      process.env.FLOW_HEADLESS !== undefined ? process.env.FLOW_HEADLESS === "1" : Boolean(merged.headless),
    channel: process.env.FLOW_CHANNEL || merged.channel || "chrome",
    renderTimeoutMinutes: Number(merged.renderTimeoutMinutes) || 15,
    composerTimeoutMinutes: Number(merged.composerTimeoutMinutes) || 20,
    creditTimeoutMinutes: Number(merged.creditTimeoutMinutes) || 3,
    defaultProjectId: process.env.FLOW_PROJECT_ID || merged.defaultProjectId || "",
    dryRun: process.env.FLOW_BRIDGE_DRYRUN !== undefined ? DRY_RUN() : Boolean(merged.dryRun),
  };
}

export async function saveFlowConfig(patch = {}) {
  const current = await getFlowConfig();
  const next = {
    activeProfile: patch.activeProfile !== undefined ? String(patch.activeProfile).trim() : current.activeProfile,
    rotationStrategy:
      patch.rotationStrategy && ["active_only", "fallback", "round_robin"].includes(patch.rotationStrategy)
        ? patch.rotationStrategy
        : current.rotationStrategy,
    dailyBudgetCredits:
      patch.dailyBudgetCredits !== undefined
        ? Math.max(0, Number(patch.dailyBudgetCredits) || 0)
        : current.dailyBudgetCredits,
    hostResolution:
      patch.hostResolution && ["360p", "720p"].includes(patch.hostResolution)
        ? patch.hostResolution
        : current.hostResolution,
    headless: patch.headless !== undefined ? Boolean(patch.headless) : current.headless,
    channel:
      patch.channel && ["chrome", "auto", "internal"].includes(patch.channel) ? patch.channel : current.channel,
    renderTimeoutMinutes:
      patch.renderTimeoutMinutes !== undefined
        ? Math.min(60, Math.max(1, Number(patch.renderTimeoutMinutes) || 15))
        : current.renderTimeoutMinutes,
    composerTimeoutMinutes:
      patch.composerTimeoutMinutes !== undefined
        ? Math.min(60, Math.max(1, Number(patch.composerTimeoutMinutes) || 20))
        : current.composerTimeoutMinutes,
    creditTimeoutMinutes:
      patch.creditTimeoutMinutes !== undefined
        ? Math.min(15, Math.max(1, Number(patch.creditTimeoutMinutes) || 3))
        : current.creditTimeoutMinutes,
    defaultProjectId:
      patch.defaultProjectId !== undefined ? String(patch.defaultProjectId).trim() : current.defaultProjectId,
    dryRun: patch.dryRun !== undefined ? Boolean(patch.dryRun) : current.dryRun,
  };
  await updateSettings({ flowConfig: next });
  return getFlowConfig();
}

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
export async function assertAffordable(creditCost, profile = null, isDryRun = false) {
  if (DRY_RUN() || isDryRun || creditCost === 0) return;
  const snapshot = await getLatestFlowCreditSnapshot(profile);
  if (!snapshot) {
    throw new FlowRequestError(
      "Balance unknown: refresh Flow credits before spending. Submit is blocked because a job can cost more than the account holds.",
      409
    );
  }
  if (snapshot.balance < creditCost) {
    throw new FlowRequestError(`Insufficient Flow credits: need ${creditCost}, last known balance ${snapshot.balance}${profile ? ` (${profile})` : ""}`, 402);
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
export async function assertWithinDailyBudget(creditCost, { capOverride = null, isDryRun = false, profile = "" } = {}) {
  const cap = capOverride !== null ? Number(capOverride) || 0 : dailyBudget();
  if (DRY_RUN() || isDryRun || !cap || creditCost === 0) return { cap: 0, spent: 0 };
  const { credits } = await sumFlowCreditsSince(localDayStart(), profile);
  if (credits + creditCost > cap) {
    throw new FlowRequestError(
      `Daily Flow budget reached: ${credits} of ${cap} credits already spent today, this clip needs ${creditCost}. Raise FLOW_DAILY_BUDGET_CREDITS or Daily Budget in Flow Config to allow it.`,
      429
    );
  }
  return { cap, spent: credits };
}

/** Resolve which profile should run the next job based on config and rotation strategy. */
export async function selectProfileForJob(requestedProfile = "", creditCost = 0) {
  if (requestedProfile) return String(requestedProfile).trim();
  const cfg = await getFlowConfig();
  if (cfg.rotationStrategy === "active_only" || !cfg.rotationStrategy) {
    return cfg.activeProfile || "";
  }
  try {
    const { listFlowProfiles } = await import("./driver.js");
    const profiles = (await listFlowProfiles()).filter((p) => p.cookies_present !== false);
    if (!profiles.length) return cfg.activeProfile || "";

    if (cfg.rotationStrategy === "round_robin") {
      const idx = roundRobinIndex % profiles.length;
      roundRobinIndex += 1;
      return profiles[idx].name || cfg.activeProfile || "";
    }

    if (cfg.rotationStrategy === "fallback") {
      // Order: activeProfile first (or default profile), then others
      const ordered = [
        ...profiles.filter((p) => (cfg.activeProfile ? p.name === cfg.activeProfile : p.is_default)),
        ...profiles.filter((p) => !(cfg.activeProfile ? p.name === cfg.activeProfile : p.is_default)),
      ];
      for (const p of ordered) {
        const snap = await getLatestFlowCreditSnapshot(p.name);
        if (!snap || snap.balance >= creditCost) {
          return p.name;
        }
      }
      return ordered[0]?.name || cfg.activeProfile || "";
    }
  } catch {
    /* fallback to activeProfile */
  }
  return cfg.activeProfile || "";
}

/** Balance, today's spend and the cap, for the dashboard header. */
export async function flowBudgetState(profile = null) {
  const cfg = await getFlowConfig();
  const targetProfile = profile !== null ? profile : cfg.activeProfile || null;
  const [snap, today, stats] = await Promise.all([
    getLatestFlowCreditSnapshot(targetProfile),
    sumFlowCreditsSince(localDayStart()),
    getFlowStatsSummary(),
  ]);
  const cap = cfg.dailyBudgetCredits || dailyBudget();
  return {
    profile: targetProfile || snap?.profile || null,
    balance: snap?.balance ?? null,
    balanceAt: snap?.createdAt ?? null,
    spentToday: today.credits,
    jobsToday: today.jobs,
    dailyCap: cap,
    stats,
    config: cfg,
  };
}

export async function enqueueFlowJob(input = {}) {
  const nextInput = { ...input };
  if (!nextInput.imagePath && nextInput.image) {
    nextInput.imagePath = await resolveFlowImageInput(nextInput.image);
  }
  const cfg = await getFlowConfig();
  const isDry = DRY_RUN() || Boolean(cfg.dryRun);
  const req = validateFlowRequest(nextInput);
  const profile = isDry
    ? nextInput.profile || cfg.activeProfile || null
    : (await selectProfileForJob(nextInput.profile || "", req.creditCost)) || null;
  await assertAffordable(req.creditCost, profile, isDry);
  await assertWithinDailyBudget(req.creditCost, {
    capOverride: cfg.dailyBudgetCredits,
    isDryRun: isDry,
  });
  const job = await createFlowJob({
    ...req,
    profile,
    projectId: nextInput.projectId || cfg.defaultProjectId || null,
    dryRun: isDry,
  });
  pump();
  return job;
}

/**
 * Read the balance Flow shows in its own account menu and persist it. The credit
 * gate reads only what is stored here, so an unknown balance blocks submit
 * instead of risking a render the account cannot pay for.
 */
export async function refreshFlowCredits(profile = null) {
  const cfg = await getFlowConfig();
  const targetProfile = profile || cfg.activeProfile || null;
  const { readFlowCredits } = await import("./driver.js");
  const balance = await readFlowCredits(targetProfile);
  return addFlowCreditSnapshot({ balance, profile: targetProfile, source: "driver" });
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
    const cfg = await getFlowConfig();
    const result = await driver.renderFlowJob(running, {
      profile: running.profile || cfg.activeProfile || null,
      timeoutMs: (cfg.renderTimeoutMinutes || 15) * 60 * 1000,
      onStep: (step) => {
        updateFlowJob(job.id, { step: String(step).slice(0, 200) }).catch(() => {});
      },
      // The composer may have picked a Flow project itself; store it before the
      // submit so a later resume reopens the project the clip was paid for.
      onProject: (projectId) => {
        updateFlowJob(job.id, { projectId }).catch(() => {});
      },
    });
    const done = await updateFlowJob(job.id, {
      status: "completed",
      step: "done",
      error: null,
      mediaPath: await persistVideo(job.id, result?.mediaPath),
      sourceUrl: result?.sourceUrl || null,
      projectId: result?.projectId || undefined,
      finishedAt: new Date().toISOString(),
    });
    // Awaited, not fire-and-forget: the balance read opens the same profile the
    // next queued job is about to drive, so it must not overlap it. A failure
    // here is cosmetic — the render already succeeded.
    // Flow charges the credits a few seconds after the clip is ready, so read
    // the balance only after it settles; reading at once stores a stale number
    // and the next affordability check would approve a clip the account cannot pay.
    try {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      await refreshFlowCredits(running.profile || null);
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

let activeExclusive = Promise.resolve();
let pumping = false;

/** Serialize browser/CLI actions so image and video renders never collide on the Chrome profile. */
function runExclusive(fn) {
  const next = activeExclusive.then(fn, fn);
  activeExclusive = next.catch(() => {});
  return next;
}

/** Resolve an image input (local path, /api/flow/images/{id}, /api/image-gen/assets/{id}, data:image/..., or http URL) to an on-disk path. */
export async function resolveFlowImageInput(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const [{ existsSync, mkdirSync, writeFileSync }, { join, isAbsolute }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
  ]);

  if (isAbsolute(trimmed) && existsSync(trimmed)) return trimmed;

  // /api/flow/images/{id}
  const flowImgMatch = trimmed.match(/\/api\/flow\/images\/([^/?#]+)/i);
  if (flowImgMatch) {
    const { getFlowImage } = await import("../db/repos/flowImagesRepo.js");
    const { resolveImageAssetPath } = await import("../media/imageStore.js");
    const row = await getFlowImage(flowImgMatch[1]);
    if (row?.path) {
      const abs = resolveImageAssetPath(row.path);
      if (abs && existsSync(abs)) return abs;
    }
  }

  // /api/image-gen/assets/{id}
  const genImgMatch = trimmed.match(/\/api\/image-gen\/assets\/([^/?#]+)/i);
  if (genImgMatch) {
    const { getImageAsset } = await import("../db/repos/imageGenRepo.js");
    const { resolveImageAssetPath } = await import("../media/imageStore.js");
    const row = await getImageAsset(genImgMatch[1]);
    if (row?.path) {
      const abs = resolveImageAssetPath(row.path);
      if (abs && existsSync(abs)) return abs;
    }
  }

  // data:image/*;base64,...
  const dataMatch = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/i);
  if (dataMatch) {
    const { DATA_DIR } = await import("../dataDir.js");
    const { randomUUID } = await import("node:crypto");
    const ext = dataMatch[1].toLowerCase().includes("jpeg") ? ".jpg" : dataMatch[1].toLowerCase().includes("webp") ? ".webp" : ".png";
    const uploadDir = join(DATA_DIR, "flow", "uploads");
    mkdirSync(uploadDir, { recursive: true });
    const abs = join(uploadDir, `${randomUUID()}${ext}`);
    writeFileSync(abs, Buffer.from(dataMatch[2], "base64"));
    return abs;
  }

  // http(s) URL
  if (/^https?:\/\//i.test(trimmed)) {
    const { DATA_DIR } = await import("../dataDir.js");
    const { randomUUID } = await import("node:crypto");
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(30000) });
    if (res.ok) {
      const mime = (res.headers.get("content-type") || "").toLowerCase();
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : mime.includes("webp") ? ".webp" : ".png";
      const uploadDir = join(DATA_DIR, "flow", "uploads");
      mkdirSync(uploadDir, { recursive: true });
      const abs = join(uploadDir, `${randomUUID()}${ext}`);
      writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
      return abs;
    }
  }

  return null;
}

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
      await runExclusive(() => runJob(job));
      active -= 1;
    }
  } catch (error) {
    console.error("[FLOW] queue pump error:", error?.message || error);
  } finally {
    pumping = false;
  }
}

/**
 * Render one image through the Flow browser bridge (serialized with video jobs)
 * and persist it into flowImages + media/images so it is reusable for i2v.
 */
export async function generateFlowImage(body = {}) {
  const model = String(body.model || "nano2").replace(/^flow\//i, "");
  const spec = FLOW_IMAGE_MODELS[model];
  if (!spec) throw new FlowRequestError(`Unknown Flow image model '${model}'`);

  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new FlowRequestError("prompt is required");
  if (prompt.length > 4000) throw new FlowRequestError("prompt is longer than 4000 characters");

  let aspect = String(body.aspect_ratio || body.aspect || "");
  if (!aspect && body.size) {
    const sizeMap = {
      "1024x1024": "1:1",
      "1024x1792": "9:16",
      "1792x1024": "16:9",
      "1920x800": "16:9",
      "1024x1536": "3:4",
      "1536x1024": "4:3",
    };
    aspect = sizeMap[body.size] || "16:9";
  }
  if (!aspect || !spec.aspects.includes(aspect)) aspect = spec.aspects[0];

  const rawRef = body.imagePath || body.image || (Array.isArray(body.images) ? body.images[0] : null);
  const imagePath = rawRef ? await resolveFlowImageInput(rawRef) : null;

  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();

  if (DRY_RUN()) {
    return {
      id,
      url: `/api/flow/images/${id}`,
      b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      mime: "image/png",
      dry_run: true,
    };
  }

  return runExclusive(async () => {
    const cfg = await getFlowConfig();
    const { renderFlowImage } = await import("./driver.js");
    const result = await renderFlowImage({
      id,
      prompt,
      model,
      aspect,
      imagePath,
      projectId: body.projectId || cfg.defaultProjectId || null,
      profile: body.profile || cfg.activeProfile || null,
    });

    const [{ readFileSync }, { writeImageAssetFile }, { addFlowImage }] = await Promise.all([
      import("node:fs"),
      import("../media/imageStore.js"),
      import("../db/repos/flowImagesRepo.js"),
    ]);

    const buffer = readFileSync(result.mediaPath);
    const written = writeImageAssetFile({ id, buffer, mime: "image/png" });
    await addFlowImage({
      id,
      name: prompt.slice(0, 60),
      path: written.rel,
      mime: written.mime,
      origin: "generated",
    });

    return {
      id,
      url: `/api/flow/images/${id}`,
      b64_json: buffer.toString("base64"),
      mime: written.mime,
    };
  });
}

/** Map a stored job onto the async-job shape /v1/videos callers already poll. */
export function flowJobToResponse(job) {
  if (!job) return null;
  const status = job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "processing";
  const videoUrl = job.mediaPath
    ? job.mediaPath.startsWith("/api/")
      ? job.mediaPath
      : job.mediaPath.startsWith("media/videos/")
        ? `/api/video-prompt/media/${job.id}`
        : job.mediaPath
    : job.sourceUrl || null;
  return {
    request_id: job.id,
    id: job.id,
    profile: job.profile || undefined,
    status,
    model: job.model,
    mode: job.mode,
    step: job.step,
    duration: job.duration,
    aspect_ratio: job.aspect,
    resolution: job.resolution,
    credit_cost: job.creditCost,
    dry_run: job.dryRun,
    video: videoUrl ? { url: videoUrl, ...(job.sourceUrl ? { source_url: job.sourceUrl } : {}) } : undefined,
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
  const imageModels = Object.entries(FLOW_IMAGE_MODELS).map(([id, spec]) => ({
    id,
    name: spec.name,
    aspects: spec.aspects,
    maxRefs: spec.maxRefs,
    credits: 0,
  }));
  const limits = {
    maxPromptChars: 4000,
    maxConcurrentPerAccount: 1,
    maxImageUploadMb: 10,
    staleJobTimeoutMin: 45,
    creditSettlementDelaySec: 15,
    supportedModes: ["t2v", "i2v", "t2i", "i2i"],
    tiers: [
      { tier: "Google AI Pro", monthlyCredits: 1000, note: "Termasuk akses Veo 3.1 Lite/Fast & Omni Flash" },
      { tier: "Google AI Ultra", monthlyCredits: 12500, note: "Termasuk akses Veo 3.1 Quality & prioritas penuh" },
    ],
  };
  return { hostResolution: host, models, imageModels, limits };
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
