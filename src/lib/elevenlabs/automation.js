// ElevenLabs Google SSO automation (attended, one account at a time).
//
// Opens the host's real Chrome with a dedicated profile and a CDP port, signs in
// to elevenlabs.io with "Sign in with Google", then creates a personal API key
// on /app/settings/api-keys and registers it as a 9router ElevenLabs account.
//
// The person finishes the Google sign-in themselves in that window: no Google
// password is stored or typed here. The profile is kept under
// DATA_DIR/elevenlabs/profiles/<name>, so a second run usually skips login.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { DATA_DIR } from "@/lib/dataDir";
import { addElevenAccount, maskKey } from "./service.js";

const PROFILES_DIR = path.join(DATA_DIR, "elevenlabs", "profiles");
const SIGN_IN_URL = "https://elevenlabs.io/app/sign-in";
const API_KEYS_URL = "https://elevenlabs.io/app/developers/api-keys";
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const KEY_TIMEOUT_MS = 8 * 60 * 1000;
const KEY_RE = /\bsk_[A-Za-z0-9]{32,}\b/;

// Survives Next.js route-module reloads within one server process.
const store = (globalThis.__elevenlabsAutomation ??= { jobs: new Map(), running: null, queue: [] });
const DONE_STATUSES = ["completed", "failed", "cancelled"];

export class AutomationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function publicJob(job) {
  if (!job) return null;
  const { secret, password, child, browser, ...rest } = job;
  const queueIndex = store.queue.indexOf(job.id);
  return { ...rest, hasPassword: Boolean(password), queuePosition: queueIndex >= 0 ? queueIndex + 1 : null };
}

function log(job, message) {
  job.steps.push({ at: new Date().toISOString(), message });
  if (job.steps.length > 80) job.steps.splice(0, job.steps.length - 80);
  job.updatedAt = new Date().toISOString();
}

function setStatus(job, status, message) {
  job.status = status;
  if (message) log(job, message);
}

export function listAutomationJobs() {
  return [...store.jobs.values()]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 40)
    .map(publicJob);
}

export function listAutomationProfiles() {
  try {
    return fs
      .readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function findChrome() {
  const env = process.env.ELEVENLABS_CHROME_PATH || process.env.CHROME_PATH;
  const candidates = [
    env,
    process.platform === "win32" && path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    process.platform === "win32" && path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    process.platform === "win32" && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    process.platform === "darwin" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    process.platform === "linux" && "/usr/bin/google-chrome",
    process.platform === "linux" && "/usr/bin/google-chrome-stable",
    process.platform === "linux" && "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(port, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error("Chrome tidak membuka port debugging. Tutup Chrome yang memakai profil ini lalu coba lagi.");
}

function checkCancelled(job) {
  if (job.status === "cancelled") throw new AutomationError("Dibatalkan", 499);
}

/** Recursively look for an sk_ key in a JSON response body. */
function findKeyInJson(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (typeof value === "string") return KEY_RE.test(value) ? value.match(KEY_RE)[0] : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findKeyInJson(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) {
      const hit = findKeyInJson(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function isElevenApp(url) {
  try {
    const u = new URL(url);
    return u.hostname === "elevenlabs.io" && u.pathname.startsWith("/app") && !/\/(sign-in|sign-up|auth)/.test(u.pathname);
  } catch {
    return false;
  }
}

async function clickByText(scope, pattern, { timeout = 8000 } = {}) {
  const loc = scope.locator("button, [role=button], a").filter({ hasText: pattern }).first();
  await loc.waitFor({ state: "visible", timeout });
  await loc.click();
}

async function scanDomForKey(page) {
  try {
    const text = await page.evaluate(() => {
      const parts = [];
      for (const el of document.querySelectorAll("input, textarea")) parts.push(el.value || "");
      for (const el of document.querySelectorAll("[role=dialog], code, pre")) parts.push(el.innerText || "");
      return parts.join("\n");
    });
    const m = text.match(KEY_RE);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

async function fillGoogleInput(locator, value) {
  await locator.click({ timeout: 2000 }).catch(() => {});
  await locator.fill(value, { timeout: 4000 }).catch(() => {});
  const current = await locator.inputValue().catch(() => "");
  if (current === value) return;
  await locator
    .evaluate((el, next) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, next);
      else el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value)
    .catch(() => {});
}

async function clickGoogleNext(googlePage, selectors) {
  for (const sel of selectors) {
    const btn = googlePage.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 3000, force: true }).catch(() => {});
      return;
    }
  }
  await googlePage.keyboard.press("Enter").catch(() => {});
}

async function stepGoogleSignIn(job, googlePage, state) {
  try {
    // 1. Password screen first (#identifierId stays in DOM after email step)
    const pwdInput = googlePage.locator('input[name="Passwd"], input[type="password"]').first();
    if (await pwdInput.isVisible().catch(() => false)) {
      if (job.password && Date.now() - state.lastPasswordAt > 6000) {
        state.lastPasswordAt = Date.now();
        await fillGoogleInput(pwdInput, job.password);
        await clickGoogleNext(googlePage, [
          "#passwordNext button",
          "#passwordNext",
          'button:has-text("Next")',
          'button:has-text("Berikutnya")',
        ]);
        log(job, "Password Google diisi otomatis");
      }
      return;
    }

    // 2. Account chooser tile matching email
    if (job.email) {
      const tile = googlePage.locator(`[data-identifier="${job.email}"]`).first();
      if (await tile.isVisible().catch(() => false)) {
        if (Date.now() - state.lastChooserAt > 5000) {
          state.lastChooserAt = Date.now();
          await tile.click({ timeout: 3000 }).catch(() => {});
          log(job, `Memilih akun ${job.email} di Google`);
        }
        return;
      }
    }

    // 3. Email / identifier screen
    const emailInput = googlePage
      .locator('#identifierId, input[type="email"], input[name="identifier"], input[autocomplete*="username"]')
      .first();
    if (job.email && (await emailInput.isVisible().catch(() => false))) {
      if (Date.now() - state.lastEmailAt > 6000) {
        state.lastEmailAt = Date.now();
        await googlePage.keyboard.press("Escape").catch(() => {});
        await fillGoogleInput(emailInput, job.email);
        await clickGoogleNext(googlePage, [
          "#identifierNext button",
          "#identifierNext",
          'button:has-text("Next")',
          'button:has-text("Berikutnya")',
        ]);
        log(job, `Email ${job.email} diisi otomatis di Google`);
      }
      return;
    }

    // 4. If chooser shows other accounts without email input, click "Use another account"
    if (job.email && Date.now() - state.lastUseAnotherAt > 5000) {
      const useAnother = googlePage
        .locator('li, [role="link"], [role="button"]')
        .filter({ hasText: /use another account|gunakan akun lain/i })
        .first();
      if (await useAnother.isVisible().catch(() => false)) {
        state.lastUseAnotherAt = Date.now();
        await useAnother.click({ timeout: 3000 }).catch(() => {});
        return;
      }
    }

    // 5. OAuth consent / continue confirmation screen
    if ((state.lastEmailAt > 0 || state.lastPasswordAt > 0 || state.lastChooserAt > 0) && Date.now() - state.lastConsentAt > 4000) {
      const consentBtn = googlePage
        .locator('#submit_approve_access, #confirm, button, [role="button"], input[type="submit"], input[type="button"]')
        .filter({ hasText: /^(continue|lanjutkan|allow|izinkan|confirm|konfirmasi|i understand|saya mengerti|agree|setuju)$/i })
        .first();
      if (await consentBtn.isVisible().catch(() => false)) {
        state.lastConsentAt = Date.now();
        await consentBtn.click({ timeout: 3000 }).catch(() => {});
        log(job, "Menyetujui konfirmasi login Google");
      }
    }
  } catch {
    // Ignore transient DOM / navigation errors while Google page redirects
  }
}

async function signIn(job, context, page) {
  setStatus(job, "signing_in", "Membuka halaman sign-in ElevenLabs");
  await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  if (isElevenApp(page.url())) {
    log(job, "Profil ini sudah login ke ElevenLabs");
    return page;
  }

  try {
    await clickByText(page, /sign in with google/i, { timeout: 15000 });
    log(job, "Tombol 'Sign in with Google' diklik");
  } catch (e) {
    log(job, `Tidak bisa klik tombol Google otomatis (${e.message.split("\n")[0]}). Klik manual di jendela Chrome.`);
  }

  setStatus(
    job,
    "waiting_login",
    job.password
      ? "Mengisi login Google otomatis di jendela Chrome (selesaikan 2FA/captcha jika diminta). Menunggu maksimal 10 menit."
      : "Mengisi email Google otomatis; selesaikan login di jendela Chrome (password / 2FA). Menunggu maksimal 10 menit."
  );
  const googleState = {
    lastEmailAt: 0,
    lastPasswordAt: 0,
    lastChooserAt: 0,
    lastUseAnotherAt: 0,
    lastConsentAt: 0,
  };
  const until = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < until) {
    checkCancelled(job);
    const pages = context.pages();
    const appPage = pages.find((p) => isElevenApp(p.url()));
    if (appPage) {
      log(job, "Login ElevenLabs berhasil");
      return appPage;
    }
    if (!pages.length) throw new AutomationError("Jendela Chrome ditutup sebelum login selesai");

    const googlePage = pages.find((p) => /accounts\.google\.com/i.test(p.url()));
    if (googlePage) {
      await stepGoogleSignIn(job, googlePage, googleState);
    }
    await sleep(1200);
  }
  throw new AutomationError("Waktu tunggu login habis (10 menit)");
}

async function stepOnboarding(job, page) {
  try {
    // 1. Centang checkbox konfirmasi umur (18+) jika belum dicentang sebelum klik Next
    let checkedAny = false;
    const roleCheckboxes = page.locator('[role="checkbox"]');
    const roleCount = await roleCheckboxes.count().catch(() => 0);
    for (let i = 0; i < roleCount; i += 1) {
      const cb = roleCheckboxes.nth(i);
      if (!(await cb.isVisible().catch(() => false))) continue;
      const ariaChecked = await cb.getAttribute("aria-checked").catch(() => null);
      const dataState = await cb.getAttribute("data-state").catch(() => null);
      if (ariaChecked !== "true" && dataState !== "checked") {
        await cb.click({ timeout: 1500, force: true }).catch(() => {});
        checkedAny = true;
      }
    }
    const inputCheckboxes = page.locator('input[type="checkbox"]');
    const inputCount = await inputCheckboxes.count().catch(() => 0);
    for (let i = 0; i < inputCount; i += 1) {
      const cb = inputCheckboxes.nth(i);
      if (!(await cb.isChecked().catch(() => false))) {
        await cb.check({ timeout: 1500, force: true }).catch(async () => {
          await cb.click({ timeout: 1500, force: true }).catch(() => {});
        });
        checkedAny = true;
      }
    }
    const byLabel = page.getByLabel(/by checking this box|18 years old|legal majority/i).first();
    if (!checkedAny && (await byLabel.count().catch(() => 0)) > 0) {
      const ariaChecked = await byLabel.getAttribute("aria-checked").catch(() => null);
      const isChecked = (await byLabel.isChecked().catch(() => false)) || ariaChecked === "true";
      if (!isChecked) {
        await byLabel.click({ timeout: 1500, force: true }).catch(() => {});
        checkedAny = true;
      }
    }
    if (!checkedAny) {
      const adultError = await page
        .locator("text=/you must be an adult/i")
        .first()
        .isVisible()
        .catch(() => false);
      const ageLabel = page
        .locator("label, button, [role='checkbox']")
        .filter({ hasText: /by checking this box|18 years old|legal majority/i })
        .first();
      if ((adultError || !job._ageBoxClicked) && (await ageLabel.isVisible().catch(() => false))) {
        job._ageBoxClicked = true;
        await ageLabel.click({ timeout: 1500, position: { x: 12, y: 12 } }).catch(async () => {
          await ageLabel.click({ timeout: 1500 }).catch(() => {});
        });
        checkedAny = true;
      }
    }
    if (checkedAny) {
      log(job, "Onboarding: centang konfirmasi umur 18+");
      await sleep(400);
    }

    // 2. Pilih "Eleven Creative" jika kartu produk tampil
    const creative = page
      .locator('[role="radio"], [role="button"], button, label, div')
      .filter({ hasText: /eleven\s*creative/i })
      .last();
    if (await creative.isVisible().catch(() => false)) {
      await creative.click({ timeout: 1500 }).catch(() => {});
    }

    // 3. Utamakan tombol Skip jika tersedia, selain itu klik Next / Continue / Get started / Finish
    const skipBtn = page
      .locator('button, [role="button"], a')
      .filter({ hasText: /^\s*(skip(\s+for\s+now)?|lewati)\s*$/i })
      .first();
    if (await skipBtn.isVisible().catch(() => false)) {
      await skipBtn.click({ timeout: 2000 }).catch(() => {});
      log(job, "Onboarding: klik Skip");
      return;
    }

    const nextBtn = page
      .locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
      .filter({ hasText: /^\s*(next|continue|get started|finish|done|complete|lanjut|selesai)\s*$/i })
      .last();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click({ timeout: 2000 }).catch(() => {});
      log(job, "Onboarding: klik Next");
    }
  } catch {}
}

function isOnKeysPage(url) {
  return /\/(developers|settings)\/api-keys/i.test(url);
}

async function unrestrictDialogPermissions(job, dialog) {
  // 1. Matikan switch "Restrict key" jika aktif
  const switches = dialog.locator('[role="switch"][aria-checked="true"]');
  const swCount = await switches.count().catch(() => 0);
  if (swCount > 0) {
    for (let i = 0; i < swCount; i += 1) {
      await switches.nth(i).click({ timeout: 1500 }).catch(() => {});
    }
    log(job, "Opsi 'Restrict key' dimatikan (akses semua)");
    await sleep(300);
  }

  // 2. Jika opsi level akses berupa tombol/radio/tab "Full access" / "Unrestricted" / "Read and Write", klik semua yang mengizinkan akses tertinggi
  const fullOpts = dialog
    .locator('button, [role="radio"], [role="tab"], [role="option"], label')
    .filter({ hasText: /^\s*(unrestricted|full\s*access|all\s*permissions|read\s*(&|and)\s*write|write|access)\s*$/i });
  const optCount = await fullOpts.count().catch(() => 0);
  for (let i = 0; i < optCount; i += 1) {
    const opt = fullOpts.nth(i);
    if (await opt.isVisible().catch(() => false)) {
      await opt.click({ timeout: 1000 }).catch(() => {});
    }
  }
}

async function createApiKey(job, context, page) {
  setStatus(job, "creating_key", "Membuka halaman API keys");
  const onResponse = async (res) => {
    if (job.secret) return;
    const url = res.url();
    if (!/elevenlabs\.io/.test(url) || !/api[-_]?key/i.test(url)) return;
    if (res.request().method() !== "POST") return;
    const body = await res.json().catch(() => null);
    const key = findKeyInJson(body);
    if (key) job.secret = key;
  };
  context.on("response", onResponse);

  try {
    // New accounts can land on onboarding first; handle onboarding and steer to the keys page.
    const until = Date.now() + KEY_TIMEOUT_MS;
    let lastNav = 0;
    let lastAttempt = 0;
    let manualNoticeShown = false;
    while (Date.now() < until && !job.secret) {
      checkCancelled(job);
      if (!context.pages().length) throw new AutomationError("Jendela Chrome ditutup sebelum API key dibuat");
      const currentUrl = page.url();
      const onKeys = isOnKeysPage(currentUrl);

      if (/\/onboarding/i.test(currentUrl)) {
        await stepOnboarding(job, page);
        await sleep(1800);
        continue;
      }

      if (!onKeys && Date.now() - lastNav > 12000) {
        lastNav = Date.now();
        await page.goto(API_KEYS_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
        await sleep(2500);
        if (/\/onboarding/i.test(page.url())) {
          log(job, "Melewati onboarding ElevenLabs otomatis...");
          await stepOnboarding(job, page);
        }
        continue;
      }

      if (onKeys && Date.now() - lastAttempt > 8000) {
        lastAttempt = Date.now();
        try {
          const dialog = page.locator("[role=dialog]").last();
          if (!(await dialog.isVisible().catch(() => false))) {
            await clickByText(page, /create( an)?( api)? key|^\s*create key\s*$/i, { timeout: 8000 });
            await dialog.waitFor({ state: "visible", timeout: 8000 });
          }
          const nameInput = dialog.locator('input:not([type]), input[type="text"]').first();
          if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nameInput.fill(job.keyName);
          }
          await unrestrictDialogPermissions(job, dialog);
          const submitBtn = dialog
            .locator('button:not([disabled]), [role="button"]:not([aria-disabled="true"])')
            .filter({ hasText: /^\s*create(\s+(api\s+)?key)?\s*$/i })
            .last();
          await submitBtn.click({ timeout: 5000 });
          log(job, `Membuat API key '${job.keyName}' (akses semua)`);
          await sleep(2000);
        } catch (e) {
          if (!manualNoticeShown) {
            manualNoticeShown = true;
            setStatus(
              job,
              "waiting_key",
              `Klik otomatis belum selesai (${e.message.split("\n")[0]}). Akan dicoba lagi atau buat manual di Chrome.`
            );
          }
        }
      }

      if (!job.secret) {
        const domKey = await scanDomForKey(page);
        if (domKey) job.secret = domKey;
      }
      if (!job.secret) await sleep(1500);
    }
    if (!job.secret) throw new AutomationError("API key tidak terdeteksi dalam batas waktu");
    log(job, `API key tertangkap: ${maskKey(job.secret)}`);
  } finally {
    context.off("response", onResponse);
  }
}

async function runJob(job) {
  const chrome = findChrome();
  if (!chrome) throw new AutomationError("Google Chrome tidak ditemukan. Set env ELEVENLABS_CHROME_PATH ke chrome.exe.");

  const profileDir = path.join(PROFILES_DIR, job.profile);
  fs.mkdirSync(profileDir, { recursive: true });
  const port = await freePort();
  log(job, `Menjalankan Chrome (profil '${job.profile}')`);
  job.child = spawn(
    chrome,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=WebAuthenticationConditionalUI",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: false }
  );
  job.child.on("exit", () => {
    job.child = null;
  });

  await waitForCdp(port);
  const { chromium } = await import("playwright");
  job.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = job.browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  const appPage = await signIn(job, context, page);
  checkCancelled(job);
  await createApiKey(job, context, appPage);
  checkCancelled(job);

  setStatus(job, "saving", "Memvalidasi key dan menyimpannya ke 9router");
  let saved;
  let name = job.accountName;
  for (let i = 0; i < 5; i += 1) {
    try {
      saved = await addElevenAccount({ name, apiKey: job.secret, setActive: job.setActive });
      break;
    } catch (e) {
      if (e.status === 409 && /Nama/.test(e.message)) {
        name = `${job.accountName}-${i + 2}`;
        continue;
      }
      throw e;
    }
  }
  if (!saved) throw new AutomationError("Nama akun bentrok terus; ganti nama lalu coba lagi");
  job.result = { accountId: saved.id, accountName: saved.name, keyPreview: maskKey(job.secret), creditCheck: saved.creditCheck };
  setStatus(
    job,
    "completed",
    saved.creditCheck === "missing_user_read"
      ? `Akun '${saved.name}' tersimpan. Key tanpa permission user_read, jadi saldo belum bisa dibaca; aktifkan "User → Read" di ElevenLabs.`
      : `Akun '${saved.name}' tersimpan dan saldo terbaca`
  );
}

async function cleanup(job) {
  try {
    await job.browser?.close();
  } catch {}
  job.browser = null;
  if (job.child && !job.child.killed) {
    try {
      job.child.kill();
    } catch {}
  }
  job.child = null;
  job.secret = null;
  job.password = null;
}

export function parseAccountLine(rawLine, index, fallbackPrefix = "eleven") {
  const line = String(rawLine || "").trim();
  if (!line || line.startsWith("#")) return null;
  let parts;
  if (line.includes("|")) {
    parts = line.split("|").map((p) => p.trim());
  } else if (line.includes("\t")) {
    parts = line.split("\t").map((p) => p.trim());
  } else if (line.includes(":") && line.slice(0, line.indexOf(":")).includes("@")) {
    const idx = line.indexOf(":");
    parts = [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
  } else {
    parts = line.split(/[,;]+/).map((p) => p.trim());
  }
  parts = parts.filter(Boolean);

  let name = "";
  let email = "";
  let password = "";

  if (parts.length >= 3 && parts[1].includes("@") && !parts[0].includes("@")) {
    // nama_profil|email@gmail.com|password
    name = parts[0];
    email = parts[1];
    password = parts.slice(2).join("|");
  } else if (parts.length >= 2 && parts[0].includes("@")) {
    // email@gmail.com|password
    email = parts[0];
    password = parts.slice(1).join("|");
    name = slug(email.split("@")[0]) || `${fallbackPrefix}-${index + 1}`;
  } else if (parts.length >= 2) {
    // nama_profil|email@gmail.com
    name = parts[0];
    email = parts[1];
  } else if (parts[0]?.includes("@")) {
    // email@gmail.com
    email = parts[0];
    name = slug(email.split("@")[0]) || `${fallbackPrefix}-${index + 1}`;
  } else {
    // nama_profil saja
    name = parts[0] || "";
  }

  const accountName = name.slice(0, 50);
  if (!accountName) throw new AutomationError(`Baris ${index + 1}: nama akun wajib diisi`);
  const mail = email.toLowerCase();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    throw new AutomationError(`Baris ${index + 1}: format email '${email}' tidak valid`);
  }
  return { accountName, email: mail || null, password: password || null };
}

function createJobRecord({ accountName, email, password, setActive, keepBrowserOpen }) {
  return {
    id: uuidv4(),
    accountName,
    email: email || null,
    password: password || null,
    profile: slug(accountName) || "default",
    keyName: `9router-${new Date().toISOString().slice(0, 10)}`,
    setActive: Boolean(setActive),
    keepBrowserOpen: Boolean(keepBrowserOpen),
    status: "queued",
    steps: [{ at: new Date().toISOString(), message: "Menunggu giliran di antrean login" }],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function pumpQueue() {
  store.queue ??= [];
  if (store.running) {
    const cur = store.jobs.get(store.running);
    if (cur && !DONE_STATUSES.includes(cur.status)) return;
    store.running = null;
  }

  while (store.queue.length > 0) {
    const nextId = store.queue.shift();
    const job = store.jobs.get(nextId);
    if (!job || DONE_STATUSES.includes(job.status)) continue;

    store.running = job.id;
    setStatus(job, "starting", "Memulai proses login dari antrean");

    runJob(job)
      .catch((e) => {
        if (job.status !== "cancelled") {
          job.error = String(e?.message || e).slice(0, 500);
          setStatus(job, "failed", `Gagal: ${job.error}`);
        }
      })
      .finally(async () => {
        if (job.keepBrowserOpen && job.status === "completed") {
          try {
            await job.browser?.close();
          } catch {}
          job.browser = null;
          job.child = null; // leave Chrome running for the person
          job.secret = null;
          job.password = null;
        } else {
          await cleanup(job);
        }
        if (store.running === job.id) store.running = null;
        pumpQueue();
      });
    break;
  }
}

export function startElevenAutomation({ name, email, password, accounts, setActive = true, keepBrowserOpen = false } = {}) {
  store.queue ??= [];
  let items = [];

  if (Array.isArray(accounts) && accounts.length > 0) {
    items = accounts
      .map((item, idx) =>
        typeof item === "string"
          ? parseAccountLine(item, idx)
          : parseAccountLine([item?.name, item?.email, item?.password].map((v) => String(v || "").trim()).filter(Boolean).join("|"), idx)
      )
      .filter(Boolean);
  } else if (typeof accounts === "string" && accounts.trim()) {
    items = accounts
      .split(/\r?\n/)
      .map((line, idx) => parseAccountLine(line, idx))
      .filter(Boolean);
  } else {
    const singleLine = [name, email, password]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join("|");
    const parsed = parseAccountLine(singleLine, 0);
    if (parsed) items = [parsed];
  }

  if (!items.length) throw new AutomationError("Minimal satu akun wajib diisi");

  const created = items.map((item, idx) => {
    const job = createJobRecord({
      accountName: item.accountName,
      email: item.email,
      password: item.password,
      // Jika tambah banyak sekaligus, jadikan aktif pada akun terakhir (atau sesuai flag jika 1 akun)
      setActive: Boolean(setActive) && (items.length === 1 || idx === items.length - 1),
      keepBrowserOpen,
    });
    store.jobs.set(job.id, job);
    store.queue.push(job.id);
    return job;
  });

  pumpQueue();
  return created.map(publicJob);
}

export async function cancelElevenAutomation(id) {
  store.queue ??= [];
  if (id === "all_queued") {
    const cancelled = [];
    while (store.queue.length > 0) {
      const qId = store.queue.shift();
      const j = store.jobs.get(qId);
      if (j && !DONE_STATUSES.includes(j.status)) {
        setStatus(j, "cancelled", "Dibatalkan dari antrean oleh pengguna");
        cancelled.push(publicJob(j));
      }
    }
    return cancelled;
  }
  const job = store.jobs.get(id);
  if (!job) throw new AutomationError("Job tidak ditemukan", 404);
  const qIdx = store.queue.indexOf(id);
  if (qIdx >= 0) store.queue.splice(qIdx, 1);
  if (DONE_STATUSES.includes(job.status)) return publicJob(job);
  setStatus(job, "cancelled", "Dibatalkan oleh pengguna");
  await cleanup(job);
  if (store.running === id) {
    store.running = null;
    pumpQueue();
  }
  return publicJob(job);
}
