// Flow composer driver: the only path that can attach an image.
//
// The `gflow` CLI owns t2v on this account (see ./driver.js), but its i2v/r2v
// drivers are unported on the agent-only flow.google.com host (#799) and its
// REST-ish helpers (`image upload`, `character list`) answer 410/401 there. So
// i2v goes through the real web app instead: a Playwright context on the same
// signed-in Chrome profile, driving the agent composer.
//
// Verified against the live UI (Indonesian locale, 2026-10-30):
//   composer        div.ProseMirror[aria-label="Apa yang ingin Anda buat?"]
//   attach          button[aria-label="Tambahkan bahan ke kotak perintah"]
//                   -> bottom sheet: [upload Upload media], project media tiles
//                   -> clicking a tile attaches and closes the sheet
//                   -> composer gains img[alt="Gambar bahan"]
//   submit          button[aria-label="Mulai pembuatan"]
//   approval gate   buttons "Setuju" / "Selalu setujui" / "Tolak"
//   result          batchexecute JSON carries https://flow-content.google/video/{id}?Expires=…
//                   (the "Download" menu just re-fetches that URL as a blob)
//
// Every generation here spends credits on the first submit, so nothing retries
// after the submit button is clicked.

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { flowCliModel } from "../../../open-sse/providers/registry/flow.js";

const TIMEOUT_MS = () => Number(process.env.FLOW_COMPOSER_TIMEOUT_MS) || 20 * 60 * 1000;
const DEBUG = () => process.env.FLOW_DEBUG === "1";
const dbg = (...args) => {
  if (DEBUG()) console.log("[FLOW]", ...args);
};

/** What the chat panel currently shows; only used to explain a stuck wait. */
async function gateSnapshot(page) {
  return page.evaluate(() => {
    const msgs = [...document.querySelectorAll("flow-permission-message")];
    return {
      gates: msgs.map((m) => ({
        title: (m.querySelector(".title")?.textContent || "").trim().slice(0, 120),
        rows: [...m.querySelectorAll("[role='radio']")].map((r) => ({
          label: (r.getAttribute("aria-label") || "").trim(),
          cls: String(r.className),
          checked: r.getAttribute("aria-checked"),
        })),
      })),
      lastMessage: (document.querySelector(".agent-message-content:last-of-type")?.innerText || "")
        .replace(/\s+/g, " ")
        .slice(-200),
    };
  });
}

const SEL = {
  composer: [".ProseMirror", "[contenteditable='true'][role='textbox']"],
  attach: [
    "button[aria-label='Tambahkan bahan ke kotak perintah']",
    "button[aria-label*='Tambahkan bahan' i]",
    "button[aria-label*='Add material' i]",
    "button[aria-label*='Attach' i]",
  ],
  submit: [
    "button[aria-label='Mulai pembuatan']",
    "button[aria-label*='Mulai pembuatan' i]",
    "button[aria-label*='Start generation' i]",
  ],
  upload: ["button:has-text('Upload media')", "button:has-text('Upload')", "button:has-text('Unggah')"],
  sheet: ["mat-bottom-sheet-container", ".cdk-overlay-pane"],
};

function fail(message) {
  const error = new Error(message);
  error.flowDriver = true;
  return error;
}

/** Resolve the Chrome profile that `gflow auth login` wrote, without hardcoding a name. */
export function profileDir(explicitProfile = "") {
  if (process.env.FLOW_PROFILE_DIR) return process.env.FLOW_PROFILE_DIR;
  const base = `${process.env.LOCALAPPDATA || ""}/ffroliva/gflow-cli`;
  let profile = explicitProfile || process.env.FLOW_PROFILE || "";
  if (!profile) {
    try {
      const toml = readFileSync(`${base}/config.toml`, "utf8");
      profile = (toml.match(/default_profile\s*=\s*"([^"]+)"/) || [])[1] || "";
    } catch {
      /* no config: fall through to the env/default below */
    }
  }
  return `${base}/profile_${profile || "default"}`;
}

async function firstVisible(page, selectors, { timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count().catch(() => 0)) && (await loc.isVisible().catch(() => false))) return loc;
    }
    await page.waitForTimeout(300);
  }
  return null;
}

/** Type into the ProseMirror composer. insertText fires the input events Angular listens to. */
async function typePrompt(page, text) {
  const composer = await firstVisible(page, SEL.composer, { timeout: 20000 });
  if (!composer) throw fail("Flow composer not found (is the project page open on the signed-in profile?)");
  await composer.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
  await page.waitForTimeout(300);
}

/**
 * Attach a local image: prefer the project library, upload only when it is not there.
 *
 * Verified against the live sheet (2026-10-30): selecting a tile does not always
 * close the sheet — the footer button "Tambahkan ke perintah" is what commits the
 * selection. Clicking the tile alone leaves the composer empty, which is how the
 * first i2v run failed without spending anything.
 */
export async function attachImage(page, imagePath, { onStep = () => {} } = {}) {
  const name = basename(String(imagePath));
  const attach = await firstVisible(page, SEL.attach, { timeout: 15000 });
  if (!attach) throw fail("Composer attach button not found; the composer layout changed");

  await attach.click();
  await page.waitForTimeout(1500);

  const tileOf = () =>
    page
      .locator(`${SEL.sheet[0]} button, ${SEL.sheet[1]} button`)
      .filter({ hasText: name })
      // "Mengupload gflow_input.png" is the pending upload, not a selectable tile.
      .filter({ hasNotText: /mengupload|uploading/i })
      .first();

  let tile = tileOf();
  if (await tile.count().catch(() => 0)) {
    onStep(`attaching ${name} from library`);
  } else {
    onStep(`uploading ${name}`);
    const upload = await firstVisible(page, SEL.upload, { timeout: 8000 });
    if (!upload) throw fail(`Image ${name} is not in the project library and no upload entry was found`);
    const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
    await upload.click();
    const fc = await chooser;
    await fc.setFiles(String(imagePath));
    // Consent dialog on first use of a new image ("Hak untuk menggunakan gambar ini").
    const consent = page.locator("button:has-text('Saya setuju'), button:has-text('I agree')").first();
    for (let i = 0; i < 20 && !(await tileOf().count().catch(() => 0)); i++) {
      if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
    tile = tileOf();
    if (!(await tile.count().catch(() => 0))) throw fail(`Upload of ${name} never produced a selectable tile; nothing was submitted`);
    onStep(`selecting uploaded ${name}`);
  }

  await tile.click();
  await page.waitForTimeout(1200);

  // The sheet closes itself when the tile attaches directly; when it stays open,
  // its footer button commits the selection.
  const confirm = page.locator("button:has-text('Tambahkan ke perintah'), button:has-text('Add to prompt')").first();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  // The composer shows the frame as a chip outside the editor
  // (`flow-ingredient-chip > img[alt="Gambar bahan"]`), and it appears a moment
  // after the click, so wait rather than sample once.
  const attached = page.locator(".ProseMirror img, .prompt-input img, img[alt='Gambar bahan']").first();
  for (let i = 0; i < 24; i++) {
    if (await attached.count().catch(() => 0)) return;
    await page.waitForTimeout(500);
  }
  throw fail(`Image ${name} did not attach to the composer; nothing was submitted`);
}

/**
 * Answer the "spend N credits?" gate.
 *
 * The gate is not a button row: it renders as `flow-permission-message` with
 * `[role=radio]` rows (".option-row"), and a resolved one carries `.read-only`.
 * Only an interactive row is clicked, so a gate left over in the chat history is
 * never re-answered (that would spend credits for an old prompt).
 *
 * Returns the option label it clicked, or null when no live gate is on screen.
 */
async function answerCreditGate(page) {
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("flow-permission-message [role='radio']")];
    const live = rows.filter((r) => !/\bread-only\b/.test(String(r.className)));
    const pick = live.find((r) => /^(Setujui|Setuju|Approve)$/i.test((r.getAttribute("aria-label") || "").trim()));
    if (!pick) return null;
    pick.click();
    return pick.getAttribute("aria-label");
  });
  if (!clicked) return null;

  // Selecting the option may be all that is needed; if the row is still
  // unselected, the composer's submit button confirms the choice.
  await page.waitForTimeout(1200);
  const stillOpen = await page.evaluate(() =>
    [...document.querySelectorAll("flow-permission-message [role='radio']")].some(
      (r) => !/\bread-only\b/.test(String(r.className)) && r.getAttribute("aria-checked") !== "true"
    )
  );
  if (stillOpen) {
    const submit = await firstVisible(page, SEL.submit, { timeout: 5000 });
    if (submit) await submit.click().catch(() => {});
  }
  return clicked;
}

/**
 * One Chrome on the signed-in profile, with a response tap that records every
 * generated video URL Flow hands out (`flow-content.google/video/{id}`).
 */
/**
 * Chrome's `--window-position` for a headed run, or null to let Chrome place it.
 *
 * Headless is not an option for Flow: reCAPTCHA Enterprise rejects headless
 * Chromium outright. So the window stays headed and is parked off-screen
 * instead, which Flow cannot tell apart from a visible one (gflow does the
 * same by default, GFLOW_CLI_BROWSER_WINDOW_POSITION). FLOW_WINDOW_POSITION
 * overrides it with any "X,Y"; set it empty to watch the run.
 */
export function windowPositionArg({ offscreen = true } = {}) {
  const raw = process.env.FLOW_WINDOW_POSITION;
  if (raw !== undefined) {
    const match = String(raw).trim().match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    return match ? `--window-position=${match[1]},${match[2]}` : null;
  }
  return offscreen ? "--window-position=-30000,-30000" : null;
}

async function openFlowPage({ profile = "", channel = "", headless = null, offscreen = null } = {}) {
  const { chromium } = await import("playwright");
  const dir = profileDir(profile);
  const useChannel = channel || process.env.FLOW_CHANNEL || "chrome";
  const useHeadless = headless !== null ? Boolean(headless) : process.env.FLOW_HEADLESS === "1";
  let useOffscreen = offscreen;
  if (useOffscreen === null) {
    try {
      const { getFlowConfig } = await import("./bridge.js");
      useOffscreen = (await getFlowConfig()).offscreen !== false;
    } catch {
      useOffscreen = true;
    }
  }
  const position = useHeadless ? null : windowPositionArg({ offscreen: useOffscreen });
  const launch = () =>
    chromium.launchPersistentContext(dir, {
      channel: useChannel === "internal" ? undefined : useChannel,
      headless: useHeadless,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
      args: ["--no-first-run", "--no-default-browser-check", ...(position ? [position] : [])],
    });

  let ctx;
  try {
    ctx = await launch();
  } catch (error) {
    // Chrome refuses to start when a killed run left `lockfile` behind and
    // reports it as "opening in existing browser session". Clear it only if no
    // Chrome has touched the profile for a while, then retry once.
    if (!/existing browser session|already in use/i.test(String(error?.message))) throw error;
    const lock = join(dir, "lockfile");
    const stale = (() => {
      try {
        return Date.now() - statSync(lock).mtimeMs > 120000;
      } catch {
        return false;
      }
    })();
    if (!stale) {
      throw fail(
        "Flow profile is in use: another Chrome (the gflow CLI or a running job) holds it. Close it and retry; nothing was submitted."
      );
    }
    rmSync(lock, { force: true });
    ctx = await launch();
  }

  const videos = new Map();
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on("response", async (res) => {
    if (!/flow\.google\.com|batchexecute/.test(res.url())) return;
    if (!(res.headers()["content-type"] || "").includes("json")) return;
    try {
      const body = await res.text();
      // Only the media id is needed: the signed URL in this payload is escaped
      // in a way that breaks its own signature, so the clip is downloaded
      // through the UI menu (downloadFlowMedia) instead.
      for (const m of body.matchAll(/flow-content\.google\/video\/([0-9a-f-]{36})/g)) {
        videos.set(m[1], m[0]);
      }
    } catch {
      /* a failed body read only delays detection */
    }
  });
  return { ctx, page, videos };
}

// ---------------------------------------------------------------------------
// Finding the finished clip after Flow's 2026-11-19 build.
//
// Flow stopped naming clips on the page (gflow #1354): the grid tile, its hover
// player and the chat option all use opaque `flow.google.com/asb/<token>=…`
// URLs, and `flow-content.google/video/<uuid>` no longer shows up in the
// responses the old tap watched. Completion is therefore read from the DOM (no
// `flow-pending-tile` left, a new finished `flow-video-tile`), and the clip's id
// from the project listing (`Zzl0ze`), whose record poster shares the tile's
// /asb/ token. Ported from gflow 0.103 agent_only_composer.py / batchexecute.py.
// ---------------------------------------------------------------------------

const LISTING_RPC = "Zzl0ze";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CDN_VIDEO_RE = /^https:\/\/flow-content\.google\/video\/([0-9a-f-]{36})(?:[?#]|$)/i;
const STATUS_DONE = 3;
// A listed clip created this long before our submit is still accepted (clock skew).
const SUBMIT_MARGIN_MS = 15000;
const LISTING_RETRY_MS = 15000;

/** Every `["wrb.fr", rpcid, "<json>"]` frame of a batchexecute body, decoded. */
export function parseBatchexecute(text = "") {
  let body = String(text).trimStart();
  if (body.startsWith(")]}'")) body = body.slice(4);
  const frames = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("[")) continue;
    let decoded;
    try {
      decoded = JSON.parse(line);
    } catch {
      continue;
    }
    for (const item of Array.isArray(decoded) ? decoded : []) {
      if (!Array.isArray(item) || item.length < 3 || item[0] !== "wrb.fr" || typeof item[1] !== "string") continue;
      if (typeof item[2] !== "string") continue;
      try {
        frames.push({ rpcid: item[1], payload: JSON.parse(item[2]) });
      } catch {
        /* an undecodable payload is an error envelope, not a reply */
      }
    }
  }
  return frames;
}

/** The opaque token of a `/asb/<token>=…` media URL, or null. */
export function asbToken(url) {
  let path;
  try {
    path = new URL(String(url || "")).pathname;
  } catch {
    return null;
  }
  const at = path.indexOf("/asb/");
  if (at === -1) return null;
  const token = path.slice(at + 5).split("=")[0].split("/")[0];
  return token || null;
}

const at = (node, ...path) => {
  let current = node;
  for (const i of path) {
    if (!Array.isArray(current) || i >= current.length) return null;
    current = current[i];
  }
  return current;
};

function* walkLists(node) {
  if (!Array.isArray(node)) return;
  yield node;
  for (const child of node) yield* walkLists(child);
}

/** First `image/…` or `video/…` string anywhere under `node`. */
function mimeIn(node) {
  for (const list of walkLists(node)) {
    for (const value of list) {
      if (typeof value === "string" && /^(image|video)\/[a-z0-9.+-]+$/i.test(value)) return value.toLowerCase();
    }
  }
  return null;
}

/**
 * Every generation record in a `Zzl0ze` payload:
 * `[workflowId, projectId, mediaId, _, _, [[createdSec, ns], …, posterUrl @5 and @10, …], [[… mime]], [[… clipUrl]]]`.
 * Three UUIDs plus the details list at slot 5 identify a record (gflow `_is_record`).
 *
 * Measured on the 2026-11-20 build: image records carry `image/jpeg` in slot 6
 * and no status at details[8] (gflow's status slot), so the kind comes from the
 * mime and a missing status is read as "unknown", not "unfinished".
 */
export function listingRecords(payload) {
  const records = [];
  for (const node of walkLists(payload)) {
    if (node.length < 6 || !Array.isArray(node[5])) continue;
    if (![0, 1, 2].every((i) => typeof node[i] === "string" && UUID_RE.test(node[i]))) continue;
    const created = at(node, 5, 0, 0);
    const status = at(node, 5, 8, 0);
    const poster = [at(node, 5, 10), at(node, 5, 5)].find((v) => typeof v === "string" && v.startsWith("https://")) || null;
    const clip = at(node, 7, 0, 8);
    const mime = mimeIn(node.slice(6));
    records.push({
      workflowId: node[0].toLowerCase(),
      projectId: node[1].toLowerCase(),
      mediaId: node[2].toLowerCase(),
      createdMs: typeof created === "number" ? created * 1000 : null,
      status: typeof status === "number" ? status : null,
      poster,
      mime,
      kind: mime ? mime.split("/")[0] : null,
      clipUrl: typeof clip === "string" && clip.startsWith("https://") ? clip : null,
    });
  }
  return records;
}

/**
 * Clips (anything not known to be an image) created no earlier than `sinceMs`
 * minus the skew margin, oldest first. A record with a status must be done.
 */
export function clipRecordsSince(records, sinceMs) {
  return records
    .filter(
      (r) =>
        r.kind !== "image" &&
        (r.status === null || r.status === STATUS_DONE) &&
        r.createdMs !== null &&
        r.createdMs >= sinceMs - SUBMIT_MARGIN_MS
    )
    .sort((a, b) => a.createdMs - b.createdMs);
}

/** Images created since `sinceMs`: what the agent made when it did not make a video. */
export function imageRecordsSince(records, sinceMs) {
  return records.filter((r) => r.kind === "image" && r.createdMs !== null && r.createdMs >= sinceMs - SUBMIT_MARGIN_MS);
}

/** Grid + chat video state (gflow `_VIDEO_JS`). */
async function readVideoState(page) {
  return page
    .evaluate(() => {
      const src = (e) => (e ? e.currentSrc || e.src || "" : "");
      return {
        pending: document.querySelectorAll("flow-video-tile flow-pending-tile").length,
        finished: [...document.querySelectorAll("flow-video-tile")]
          .filter((t) => !t.querySelector("flow-pending-tile"))
          .map((t) => ({ video: src(t.querySelector("video")), img: src(t.querySelector("img")) })),
        options: [...document.querySelectorAll("flow-a2ui-video-option img")].map((i) => i.currentSrc || i.src || ""),
        // Image tiles too: on the 2026-11-20 build the agent can answer a video
        // request with a picture, and that must end the wait, not time it out.
        images: [...document.querySelectorAll("flow-image-tile img")].map((i) => i.currentSrc || i.src || ""),
      };
    })
    .catch(() => ({ pending: 0, finished: [], options: [], images: [] }));
}

const tileKey = (tile) => (tile ? asbToken(tile.img) || asbToken(tile.video) || tile.img || tile.video || "" : "");

/** Clip uuids the page still names through `flow-content.google/video/<uuid>` (older builds). */
function namedVideoIds(state) {
  const ids = [];
  for (const srcUrl of [...state.finished.flatMap((t) => [t.video, t.img]), ...state.options]) {
    const m = CDN_VIDEO_RE.exec(srcUrl || "");
    if (m && !ids.includes(m[1].toLowerCase())) ids.push(m[1].toLowerCase());
  }
  return ids;
}

/**
 * The project's `Zzl0ze` listing, read in a second tab so the generating page
 * never navigates mid-run. Null when Flow did not answer within the budget.
 */
export async function readProjectListing(page, projectId, { budgetMs = 30000 } = {}) {
  const tab = await page.context().newPage();
  try {
    const got = new Promise((resolve) => {
      tab.on("response", async (res) => {
        if (!res.url().includes(LISTING_RPC)) return;
        try {
          const hit = parseBatchexecute(await res.text()).find((f) => f.rpcid === LISTING_RPC);
          if (hit) resolve(hit.payload);
        } catch {
          /* a lost body leaves the read empty */
        }
      });
    });
    await tab.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "domcontentloaded", timeout: budgetMs }).catch(() => {});
    return await Promise.race([got, new Promise((resolve) => setTimeout(() => resolve(null), budgetMs))]);
  } finally {
    await tab.close().catch(() => {});
  }
}

/**
 * Finish a job whose submit already happened but whose orchestrating process
 * died (a server restart, a crash): find the clip Flow made for it and
 * download it. Never submits again.
 *
 * The clip is the oldest finished video in the project's listing created after
 * the job started. That is exact while one job at a time renders into a
 * project (the bridge queue is serial); a clip made by hand in the same project
 * between the job's start and its own clip would be picked instead.
 */
export async function resumeFlowJob(job, { onStep = () => {}, channel = "", headless = null, claimed = [] } = {}) {
  const projectId = job.projectId || process.env.FLOW_PROJECT_ID;
  if (!projectId) throw fail("resume needs the Flow project id");
  const since = Date.parse(job.startedAt || job.createdAt || "");
  if (!Number.isFinite(since)) throw fail("resume needs the job's start time");

  const { ctx, page } = await openFlowPage({ profile: job.profile || "", channel, headless });
  try {
    onStep(`reading project ${projectId}`);
    const listing = await readProjectListing(page, projectId, { budgetMs: 45000 });
    if (!listing) throw fail(`Flow did not return the listing of project ${projectId}; nothing was submitted`);
    const taken = new Set(claimed.map((id) => String(id).toLowerCase()));
    const records = listingRecords(listing);
    const record = clipRecordsSince(records, since).find((r) => !taken.has(r.mediaId) && !taken.has(r.workflowId));
    if (!record) {
      // Uploaded start frames are image records too, so only say what kind of
      // result there is, not how many images belong to this job.
      const images = imageRecordsSince(records, since).length;
      throw fail(
        images
          ? "Flow made no video after this job started, only image(s): the agent answered with a picture instead of a clip. There is nothing to download and no video credits were charged. Queue the job again."
          : `No clip in project ${projectId} created after this job started. It may still be rendering (try again in a minute), or Flow never made it. Nothing was submitted.`
      );
    }
    const out = await downloadClip(page, record, job, { projectId, onStep });
    return { ...out, mediaId: record.mediaId };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Which project the composer drives.
 *
 * i2v needs a project open (the composer lives on a project page), but the
 * caller usually has none: the dashboard form never asked for one. Flow's
 * homepage lists the account's projects newest-first, so the newest one is a
 * safe default — a project is only a container for the render, and the image is
 * uploaded into it when it is not already there.
 */
export async function resolveProjectId(page, hint) {
  if (hint) return hint;
  if (process.env.FLOW_PROJECT_ID) return process.env.FLOW_PROJECT_ID;

  await page.goto("https://flow.google.com/", { waitUntil: "domcontentloaded", timeout: 90000 });
  const budget = Number(process.env.FLOW_PROJECT_RESOLVE_MS);
  const deadline = Date.now() + (Number.isFinite(budget) ? budget : 30000);
  while (Date.now() < deadline) {
    const id = await page
      .evaluate(() => {
        const a = document.querySelector("a[href*='/project/']");
        return (a?.getAttribute("href") || "").match(/\/project\/([0-9a-f-]{36})/)?.[1] || null;
      })
      .catch(() => null);
    if (id) return id;
    await page.waitForTimeout(500);
  }
  throw fail(
    "No Flow project on this account. Open https://flow.google.com/ once and create a project, then retry. Nothing was submitted; no credits spent."
  );
}

/**
 * Render one job through the agent composer.
 * @returns {Promise<{mediaPath: string, sourceUrl: string, projectId: string}>}
 */
export async function renderFlowInComposer(job, { onStep = () => {}, onProject = () => {}, channel = "", headless = null } = {}) {
  const { ctx, page, videos } = await openFlowPage({ profile: job.profile || "", channel, headless });

  try {
    const projectId = await resolveProjectId(page, job.projectId);
    // Persisted by the bridge before anything is submitted: a resume after a
    // crashed process must reopen the project the clip was paid for.
    onProject(projectId);

    onStep(`opening project ${projectId}`);
    await page.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(6000);

    const baseline = new Set(videos.keys());

    if (job.imagePath) await attachImage(page, job.imagePath, { onStep });

    const prompt = composePrompt(job);
    await typePrompt(page, prompt);
    const submit = await firstVisible(page, SEL.submit, { timeout: 15000 });
    if (!submit) throw fail("Submit button not found; nothing was submitted, no credits spent");

    // What the grid shows right before submit: a clip already here is not ours.
    const before = await readVideoState(page);
    const domBaseline = {
      head: tileKey(before.finished[0]),
      ids: new Set(namedVideoIds(before)),
      tokens: new Set(before.finished.flatMap((t) => [asbToken(t.img), asbToken(t.video)]).filter(Boolean)),
      images: new Set(before.images.map((s) => asbToken(s) || s).filter(Boolean)),
    };

    onStep("submitting");
    const submittedAt = Date.now();
    await submit.click();
    onStep("submitted, waiting for Flow");

    const out = await harvestFlowResult(page, {
      videos,
      baseline,
      domBaseline,
      submittedAt,
      job: { ...job, projectId },
      onStep,
    });
    return { ...out, projectId };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Answer the credit gate when it appears and download the finished clip.
 *
 * The clip is found by whichever signal comes first:
 *   * a `flow-content.google/video/<uuid>` id in a response (builds before 2026-11-19);
 *   * the DOM: no pending tile left, a new finished tile, and its uuid either on
 *     the page or, from the 2026-11-19 build on, in the project listing record
 *     whose poster shares the tile's /asb/ token and was created after submit.
 * The gate is answered at most once per call, and nothing here re-submits.
 */
export async function harvestFlowResult(
  page,
  { videos, baseline, domBaseline = null, submittedAt = Date.now(), job, onStep = () => {} }
) {
  const projectId = job.projectId || process.env.FLOW_PROJECT_ID;
  const deadline = Date.now() + TIMEOUT_MS();
  let approved = null;
  let hit = null;
  let sawPending = false;
  let listingAfter = 0;
  let lastLookup = "";
  let imageSince = 0;

  while (Date.now() < deadline) {
    for (const [id] of videos) {
      if (!baseline.has(id)) {
        hit = { mediaId: id.toLowerCase(), workflowId: null };
        break;
      }
    }
    if (hit) break;

    if (domBaseline) {
      const state = await readVideoState(page);
      if (state.pending) {
        if (!sawPending) onStep("rendering in Flow");
        sawPending = true;
      }
      const head = state.finished[0];
      const fresh = head && !state.pending && tileKey(head) !== domBaseline.head;
      if (fresh) {
        const named = namedVideoIds(state).filter((id) => !domBaseline.ids.has(id));
        const token = asbToken(head.img) || asbToken(head.video);
        if (named.length) {
          hit = { mediaId: named[0], workflowId: null };
          break;
        }
        if (token && !domBaseline.tokens.has(token) && projectId && Date.now() >= listingAfter) {
          listingAfter = Date.now() + LISTING_RETRY_MS;
          const listing = await readProjectListing(page, projectId, { budgetMs: 30000 });
          const record = listing
            ? clipRecordsSince(listingRecords(listing), submittedAt).find((r) => asbToken(r.poster) === token)
            : null;
          lastLookup = listing ? (record ? "" : "listing has no record for the new tile yet") : "listing did not answer";
          if (record) {
            hit = record;
            break;
          }
        }
      }

      // A new picture and no clip on the way: the agent answered with an image.
      // Images cost no credits, so stop now instead of waiting out the timeout.
      const newImages = state.images.filter((s) => !domBaseline.images.has(asbToken(s) || s));
      if (newImages.length && !state.pending && !fresh) {
        imageSince ||= Date.now();
        if (Date.now() - imageSince > 30000) {
          throw fail(
            `Flow's agent made ${newImages.length} image(s) instead of a video (no video credits charged). The prompt probably read as an image edit: queue it again, describing the motion.`
          );
        }
      } else {
        imageSince = 0;
      }
    }

    // No separate approval window: the agent can sit on the request for minutes
    // before it asks ("menunggu dalam antrean"), so the gate is answered
    // whenever it shows up, up to the overall render timeout.
    if (!approved) {
      if (DEBUG()) dbg("waiting:", JSON.stringify(await gateSnapshot(page)));
      const answer = await answerCreditGate(page);
      if (answer) {
        approved = answer;
        onStep(`approved credit gate (${answer})`);
      }
    }
    await page.waitForTimeout(3000);
  }

  if (!hit) {
    throw fail(
      `Flow produced no video within ${Math.round(TIMEOUT_MS() / 60000)} min (gate answered=${approved}${lastLookup ? `; ${lastLookup}` : ""}). The generation may still be running or already finished in Flow: use Resume on this job (it downloads without submitting again) before retrying, a second submit spends credits twice.`
    );
  }

  const out = await downloadClip(page, hit, job, { projectId, onStep });
  return { ...out, approved, mediaId: hit.mediaId };
}

/**
 * Download a finished clip through its edit page. The listing names two ids
 * (media and workflow) and the edit route has taken the one the old
 * `flow-content.google/video/<id>` URL carried, so both are tried.
 */
async function downloadClip(page, record, job, { projectId, onStep = () => {} } = {}) {
  const dir = process.env.FLOW_OUT_DIR || join(process.cwd(), "tmp", "flow_out");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${job.id}.mp4`);
  const ids = [record.mediaId, record.workflowId].filter((id, i, all) => id && all.indexOf(id) === i);
  let lastError = null;
  for (const id of ids) {
    try {
      return await downloadFlowMedia(page, id, outPath, { projectId, onStep });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || fail("no clip id to download");
}

/**
 * Save a finished clip through the same Download menu a human clicks.
 *
 * The signed `flow-content.google` URL seen in the batchexecute payload is not
 * usable from outside the page: Flow escapes characters inside it, and the
 * reconstructed URL fails the signature check (403). The menu re-fetches the
 * blob from the page and hands it to the browser download manager, which is the
 * path that actually produces the mp4.
 */
export async function downloadFlowMedia(page, mediaId, outPath, { projectId, onStep = () => {} } = {}) {
  onStep("downloading");
  await page.goto(`https://flow.google.com/project/${projectId}/edit/${mediaId}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(6000);

  const trigger = page.locator("button:has-text('Download')").first();
  if (!(await trigger.count().catch(() => 0))) throw fail(`Download menu not found for ${mediaId} (no credits spent)`);
  await trigger.click();
  await page.waitForTimeout(1200);

  const items = page.locator("mat-menu-panel button, .mat-mdc-menu-panel button");
  const original = items.filter({ hasText: /720p|Ukuran asli|original/i }).first();
  // "Ukuran asli" is the rendered file and costs nothing; upscales to 1080p/4K
  // are a different product and are not downloaded here.
  const item = (await original.count().catch(() => 0)) ? original : items.first();
  if (!(await item.count().catch(() => 0))) throw fail(`Download menu for ${mediaId} had no items`);

  const pending = page.waitForEvent("download", { timeout: 180000 });
  await item.click();
  const download = await pending;
  await download.saveAs(outPath);
  return { mediaPath: outPath, sourceUrl: `https://flow.google.com/project/${projectId}/edit/${mediaId}` };
}

/**
 * The agent picks model/duration/aspect from prose, not from a form: state them
 * explicitly so the render matches what the credit table charged for.
 */
export function composePrompt(job) {
  // The intent goes first. On the 2026-11-20 build, a user prompt followed by a
  // trailing "(make a video…)" note, with an image attached, was answered with
  // a picture (an image edit) instead of a clip. gflow 0.103 leads with the
  // same English sentence ("Make me a N second video of …") on every locale.
  const head = [`Make me a ${job.duration} second video in a ${job.aspect} aspect ratio`];
  if (job.model) head.push(`using the ${flowCliModel(job.model)} model`);
  const frame = job.imagePath ? " Animate the attached image: use it as the first frame of the video." : "";
  return `${head.join(", ")}.${frame} Video description: ${job.prompt}\n\nGenerate exactly one video now, without follow-up questions. Do not generate an image.`;
}
