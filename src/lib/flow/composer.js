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
export function profileDir() {
  if (process.env.FLOW_PROFILE_DIR) return process.env.FLOW_PROFILE_DIR;
  const base = `${process.env.LOCALAPPDATA || ""}/ffroliva/gflow-cli`;
  let profile = process.env.FLOW_PROFILE || "";
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

/** Attach a local image: prefer the project library, upload only when it is not there. */
async function attachImage(page, imagePath, { onStep }) {
  const name = basename(String(imagePath));
  const attach = await firstVisible(page, SEL.attach, { timeout: 15000 });
  if (!attach) throw fail("Composer attach button not found; the composer layout changed");

  await attach.click();
  await page.waitForTimeout(1500);

  const tile = page.locator(`${SEL.sheet[0]} button, ${SEL.sheet[1]} button`).filter({ hasText: name }).first();
  if (await tile.count().catch(() => 0)) {
    onStep(`attaching ${name} from library`);
    await tile.click();
    await page.waitForTimeout(1500);
  } else {
    onStep(`uploading ${name}`);
    const upload = await firstVisible(page, SEL.upload, { timeout: 8000 });
    if (!upload) throw fail(`Image ${name} is not in the project library and no upload entry was found`);
    const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
    await upload.click();
    const fc = await chooser;
    await fc.setFiles(String(imagePath));
    await page.waitForTimeout(4000);
    // Consent dialog on first use of a new image ("Hak untuk menggunakan gambar ini").
    const consent = page.locator("button:has-text('Saya setuju'), button:has-text('I agree')").first();
    if (await consent.count().catch(() => 0)) {
      await consent.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    const confirm = page.locator("button:has-text('Tambahkan ke perintah'), button:has-text('Add to prompt')").first();
    if (await confirm.count().catch(() => 0)) {
      await confirm.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
  }

  const attached = page.locator(".ProseMirror img, .prompt-input img, img[alt='Gambar bahan']").first();
  if (!(await attached.count().catch(() => 0))) {
    throw fail(`Image ${name} did not attach to the composer; nothing was submitted`);
  }
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
async function openFlowPage() {
  const { chromium } = await import("playwright");
  const launch = () =>
    chromium.launchPersistentContext(profileDir(), {
      channel: process.env.FLOW_CHANNEL || "chrome",
      headless: process.env.FLOW_HEADLESS === "1",
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
      args: ["--no-first-run", "--no-default-browser-check"],
    });

  let ctx;
  try {
    ctx = await launch();
  } catch (error) {
    // Chrome refuses to start when a killed run left `lockfile` behind and
    // reports it as "opening in existing browser session". Clear it only if no
    // Chrome has touched the profile for a while, then retry once.
    if (!/existing browser session|already in use/i.test(String(error?.message))) throw error;
    const lock = join(profileDir(), "lockfile");
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

/**
 * Finish a job whose submit already happened but whose orchestrating process
 * died: answer the pending credit gate, then download. Never submits again.
 */
export async function resumeFlowJob(job, { onStep = () => {} } = {}) {
  const projectId = job.projectId || process.env.FLOW_PROJECT_ID;
  if (!projectId) throw fail("resume needs the Flow project id");

  const { ctx, page, videos } = await openFlowPage();
  try {
    onStep(`opening project ${projectId}`);
    await page.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    // Baseline AFTER the project's own media load, so the clip that is still
    // waiting for approval is not mistaken for an already-existing one.
    await page.waitForTimeout(10000);
    const baseline = new Set(videos.keys());
    return await harvestFlowResult(page, { videos, baseline, job, onStep });
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Render one job through the agent composer.
 * @returns {Promise<{mediaPath: string, sourceUrl: string}>}
 */
export async function renderFlowInComposer(job, { onStep = () => {} } = {}) {
  const projectId = job.projectId || process.env.FLOW_PROJECT_ID;
  if (!projectId) {
    throw fail(
      "i2v needs a Flow project (projectId or FLOW_PROJECT_ID). Nothing was submitted; no credits spent."
    );
  }

  const { ctx, page, videos } = await openFlowPage();

  try {
    onStep(`opening project ${projectId}`);
    await page.goto(`https://flow.google.com/project/${projectId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(6000);

    const baseline = new Set(videos.keys());

    if (job.imagePath) await attachImage(page, job.imagePath, { onStep });

    const prompt = composePrompt(job);
    await typePrompt(page, prompt);
    const submit = await firstVisible(page, SEL.submit, { timeout: 15000 });
    if (!submit) throw fail("Submit button not found; nothing was submitted, no credits spent");

    onStep("submitting");
    await submit.click();

    return await harvestFlowResult(page, { videos, baseline, job, onStep });
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Answer the credit gate when it appears and download the finished clip.
 *
 * Split out of renderFlowInComposer so a run whose orchestrating process died
 * after submit can be finished without submitting again: pass a live page and a
 * baseline of already-known video ids. The gate is answered at most once per
 * call, and never re-submits.
 */
export async function harvestFlowResult(page, { videos, baseline, job, onStep = () => {} }) {
  const dir = process.env.FLOW_OUT_DIR || join(process.cwd(), "tmp", "flow_out");
  mkdirSync(dir, { recursive: true });

  const deadline = Date.now() + TIMEOUT_MS();
  let approved = null;
  let hit = null;

  while (Date.now() < deadline) {
    for (const [id, url] of videos) {
      if (!baseline.has(id)) {
        hit = { id, url };
        break;
      }
    }
    if (hit) break;
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
      `Flow produced no video within ${Math.round(TIMEOUT_MS() / 60000)} min (gate answered=${approved}). The generation may still be running in Flow: check the project before retrying, a second submit spends credits twice.`
    );
  }

  const out = await downloadFlowMedia(page, hit.id, join(dir, `${job.id}.mp4`), {
    projectId: job.projectId || process.env.FLOW_PROJECT_ID,
    onStep,
  });
  return { ...out, approved, mediaId: hit.id };
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
  const bits = [`Buat 1 video berdurasi ${job.duration} detik`, `rasio ${job.aspect}`];
  if (job.model) bits.push(`model ${job.model}`);
  return `${job.prompt}\n\n(${bits.join(", ")}. Tanpa pertanyaan balik, langsung buat.)`;
}
