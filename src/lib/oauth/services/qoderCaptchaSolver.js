/**
 * Qoder TMD image-click captcha solver.
 *
 * Qoder's Alibaba TMD punish page is an image-matching captcha ("select all
 * images that match the description"). The harness slider solver cannot solve
 * it. This module drives a live browser page:
 *   1. Detect the captcha type (click-image grid vs slider vs QR fallback).
 *   2. For click-image: capture the grid + question, send them to a vision LLM
 *      (via a caller-supplied callback), click the matching cells, submit.
 *   3. Harvest the x5sec cookie from the browser context.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect what kind of challenge the punish page shows.
 * Returns { type: "click" | "slider" | "qr" | "unknown", detail }.
 */
export async function detectTmdCaptchaType(page) {
  try {
    const info = await page.evaluate(() => {
      const grid = document.querySelectorAll("#click-grid-0, #click-grid-1, .click-captcha-container canvas, [class*=click-captcha] canvas");
      const question = document.querySelector("#click-captcha-question-container, .click-captcha-question, #click-question-canvas");
      const slider = document.querySelector("#nc_1_n1z, .btn_slide, .nc_scale, #nc_1_wrapper");
      const qr = document.querySelector(".captcha-qrcode, [class*=qrcode], img[src*='qr']");
      const bodyText = (document.body?.innerText || "").toLowerCase();
      return {
        gridCount: grid.length,
        hasQuestion: !!question,
        hasSlider: !!slider,
        hasQr: !!qr,
        bodyText: bodyText.slice(0, 200),
      };
    });

    if (info.gridCount >= 4 || info.hasQuestion) return { type: "click", ...info };
    if (info.hasSlider) return { type: "slider", ...info };
    if (info.hasQr) return { type: "qr", ...info };
    return { type: "unknown", ...info };
  } catch {
    return { type: "unknown" };
  }
}

/**
 * Capture the click-captcha as data URLs so a vision model can read it.
 * Returns { questionDataUrl, grid: [{ index, dataUrl, x, y, w, h }] }.
 * Each grid cell canvas is serialized to PNG. Falls back to container
 * screenshot when individual canvas capture fails.
 */
export async function captureClickCaptcha(page) {
  const captured = await page.evaluate(() => {
    const out = { grids: [], hasQuestion: false };
    // Grid cells: canvas#click-grid-N OR .click-captcha-container canvas
    const cells = document.querySelectorAll("#click-grid-0, #click-grid-1, #click-grid-2, #click-grid-3, #click-grid-4, #click-grid-5, #click-grid-6, #click-grid-7, #click-grid-8, .click-captcha-bg canvas[data-id], .grid canvas");
    cells.forEach((c, index) => {
      const r = c.getBoundingClientRect();
      let dataUrl = "";
      try {
        dataUrl = c.toDataURL("image/png");
      } catch {
        dataUrl = "";
      }
      out.grids.push({
        index,
        id: c.id,
        dataId: c.getAttribute("data-id") || "",
        dataUrl,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      });
    });
    const qc = document.querySelector("#click-question-canvas, .click-captcha-question canvas");
    if (qc) {
      try { out.questionDataUrl = qc.toDataURL("image/png"); } catch { out.questionDataUrl = ""; }
      out.hasQuestion = true;
    }
    return out;
  });

  // If individual canvases are tainted/empty, fall back to a single container
  // screenshot (data URL) — the vision model reads it as one image.
  if (!captured.grids.length || captured.grids.every((g) => !g.dataUrl)) {
    const container = page.locator(".click-captcha-container, #nocaptcha, #baxia-punish").first();
    try {
      const buf = await container.screenshot({ type: "png" });
      captured.containerDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      captured.grids = []; // coordinates unknowable from screenshot alone
    } catch {}
  }

  return captured;
}

/**
 * Click the grid cells at the given indexes and submit the click captcha.
 * Returns true when the challenge advanced (or x5sec appeared).
 */
export async function submitClickCaptcha(page, indexes, { maxRetries = 3 } = {}) {
  for (const idx of indexes) {
    try {
      await page.evaluate((i) => {
        const cell = document.querySelector(`#click-grid-${i}`)
          || document.querySelectorAll(".click-captcha-bg canvas[data-id], .grid canvas")[i];
        if (!cell) return false;
        const r = cell.getBoundingClientRect();
        cell.dispatchEvent(new MouseEvent("click", {
          bubbles: true, cancelable: true,
          clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
        }));
        return true;
      }, idx);
      await sleep(250);
    } catch {}
  }

  // Click submit button.
  for (const sel of ["button:has-text('Submit')", "button:has-text('submit')", "[class*=submit]", "[class*=btn] button"]) {
    const btn = page.locator(sel).first();
    try {
      if (await btn.count() && await btn.isVisible()) {
        await btn.click();
        break;
      }
    } catch {}
  }
  await sleep(1200);

  // After submit, the page may navigate / refresh — wait and re-check for x5sec.
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const cookies = await page.context().cookies();
      const x5 = cookies.find((c) => c.name === "x5sec" && c.value);
      if (x5) return { ok: true, x5sec: x5.value };
    } catch {}
    await sleep(800);
  }
  return { ok: false };
}

/**
 * Harvest the x5sec cookie from a browser context (fallback path).
 */
export async function harvestX5secFromContext(contextOrPage) {
  try {
    const ctx = contextOrPage.context ? contextOrPage.context() : contextOrPage;
    const cookies = await ctx.cookies();
    const x5 = cookies.find((c) => c.name === "x5sec" && c.value);
    return x5 ? x5.value : "";
  } catch {
    return "";
  }
}

export const __test__ = {
  detectTmdCaptchaType,
  captureClickCaptcha,
};
