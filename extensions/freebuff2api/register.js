/**
 * register.js — native Freebuff (Codebuff) account registration.
 *
 * Ported from ../freebuff-release (freebuff_register.py + google_login.py,
 * Python + CloakBrowser) to Node + Playwright so registration is native to
 * this gateway: register → authToken lands straight in the account pool.
 *
 * Hybrid flow — the browser MUST drive the OAuth click, otherwise NextAuth
 * loses the PKCE verifier it generated server-side (OAuthCallback error):
 *   1. HTTP    POST /api/auth/cli/code   → fingerprintId + auth_code
 *   2. Browser Google login (email → password → ToS/consent)
 *   3. Browser /login?auth_code=…        → click "Continue with Google"
 *   4. Browser account chooser + consent → redirect to /onboard
 *   5. HTTP    GET /api/auth/cli/status  → authToken (no cookies needed)
 */
import { randomBytes, createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch as baseFetch, Agent } from 'undici';
import { makeProxyConnector } from './proxy.js';

export const CODEBUFF_BASE = 'https://www.codebuff.com';

const HTTP_TIMEOUT = 30_000;
const POLL_TIMEOUT = 120_000;
const POLL_INTERVAL = 2_000;
const LOGIN_ATTEMPTS = 90;      // ~90s Google login budget (1s/attempt)
const CONSENT_ATTEMPTS = 45;    // ~45s OAuth consent budget

// Consent / ToS / speedbump button labels (EN + ID) — same set as the Python handler.
const CONSENT_TEXTS = [
  'i understand', 'i agree', 'agree', 'allow', 'continue', 'approve', 'confirm',
  'accept', 'got it', 'accept all', 'done', 'i accept', 'accept & continue',
  'sign in', 'log in', 'get started', 'proceed',
  'saya mengerti', 'saya setuju', 'setuju', 'lanjutkan', 'terima', 'izinkan',
  'konfirmasi', 'mengerti', 'oke', 'ya', 'masuk', 'mulai', 'lanjut',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fingerprint() {
  const raw = randomBytes(32).toString('hex');
  return {
    fingerprintId: `nexus-fb-${raw.slice(0, 16)}`,
    fingerprintHash: createHash('sha256').update(raw).digest('hex'),
  };
}

/** undici dispatcher for an outbound proxy (http/https/socks), or undefined for direct. */
function proxyDispatcher(proxy) {
  if (!proxy) return undefined;
  return new Agent({ connect: makeProxyConnector(proxy), pipelining: 0 });
}

/** Playwright proxy option from a proxy URL (auth split out, as Playwright requires). */
function playwrightProxy(proxy) {
  if (!proxy) return undefined;
  try {
    const u = new URL(proxy);
    const opt = { server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}` };
    if (u.username) opt.username = decodeURIComponent(u.username);
    if (u.password) opt.password = decodeURIComponent(u.password);
    return opt;
  } catch {
    return { server: proxy };
  }
}

async function httpJson(url, { method = 'GET', body, dispatcher, timeout = HTTP_TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await baseFetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      dispatcher,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Step 1 — device flow: fingerprintId + loginUrl (carries auth_code). */
export async function deviceFlow({ proxy } = {}) {
  const fp = fingerprint();
  const { status, json, text } = await httpJson(`${CODEBUFF_BASE}/api/auth/cli/code`, {
    method: 'POST',
    body: { fingerprintId: fp.fingerprintId },
    dispatcher: proxyDispatcher(proxy),
  });
  if (status !== 200 || !json?.loginUrl) {
    throw new Error(`device flow failed (${status}): ${String(text).slice(0, 160)}`);
  }
  const authCode = String(json.loginUrl).split('auth_code=')[1];
  if (!authCode) throw new Error('device flow: loginUrl has no auth_code');
  return { ...fp, ...json, authCode };
}

/** Step 5 — poll cli/status until the authToken is minted (401/pending until login lands). */
export async function pollToken(device, { proxy, log = () => {}, timeout = POLL_TIMEOUT } = {}) {
  const dispatcher = proxyDispatcher(proxy);
  const started = Date.now();
  let lastTick = -1;
  while (Date.now() - started < timeout) {
    const qs = new URLSearchParams({
      fingerprintId: device.fingerprintId,
      fingerprintHash: device.fingerprintHash || '',
      expiresAt: String(device.expiresAt ?? 0),
    });
    const { status, json } = await httpJson(`${CODEBUFF_BASE}/api/auth/cli/status?${qs}`, { dispatcher });
    if (status === 200 && json) {
      const user = json.user || {};
      const token = user.authToken || json.authToken;
      if (json.status === 'ready' || token) {
        if (token) {
          log(`authToken ${String(token).slice(0, 12)}… email=${user.email || ''}`, 'ok');
          return { token: String(token), email: user.email || '', userId: user.id || '' };
        }
      }
    }
    const secs = Math.floor((Date.now() - started) / 1000);
    if (secs % 10 === 0 && secs !== lastTick) { lastTick = secs; log(`poll ${secs}s…`); }
    await sleep(POLL_INTERVAL);
  }
  throw new Error(`poll timeout after ${Math.round(timeout / 1000)}s`);
}

/**
 * Launch a browser for the Google login leg.
 *
 * Two non-negotiables, both measured against the live Google flow:
 *   - persistent context (real profile dir) + system Chrome channel
 *   - headed. Headless lands on /v3/signin/rejected ("This browser or app may
 *     not be secure") and Google downgrades to the WebLiteSignIn flow; headed
 *     gets the normal GlifWebSignIn flow and passes. On a VPS use `xvfb-run -a`.
 *     This is why the Python original needed CloakBrowser.
 */
async function launchContext({ proxy, headless = false, profileDir, log = () => {} } = {}) {
  const { chromium } = await import('playwright');
  const dir = profileDir || join(tmpdir(), `fb-reg-${randomBytes(6).toString('hex')}`);
  const opts = {
    headless,
    proxy: playwrightProxy(proxy),
    viewport: { width: 520, height: 780 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  };
  if (headless) {
    log('headless=true — Google usually answers "browser may not be secure"; use headless=false (xvfb on a VPS)', 'warn');
  }
  try {
    return { ctx: await chromium.launchPersistentContext(dir, { ...opts, channel: 'chrome' }), dir };
  } catch (e) {
    log(`system Chrome unavailable (${String(e.message).slice(0, 60)}) — falling back to bundled chromium`, 'warn');
    return { ctx: await chromium.launchPersistentContext(dir, opts), dir };
  }
}

/** page.evaluate that swallows navigation races ("execution context destroyed"). */
async function safeEval(page, fn, arg) {
  try { return await page.evaluate(fn, arg); } catch { return null; }
}

const IS_PWD_VISIBLE = () => {
  for (const el of document.querySelectorAll('input[name="Passwd"], input[type="password"]')) {
    if (el.offsetParent !== null) return true;
  }
  return false;
};

const IS_EMAIL_VISIBLE = () => {
  const el = document.querySelector('#identifierId');
  return !!(el && el.offsetParent !== null);
};

const READ_GOOGLE_ERROR = () => {
  const el = document.querySelector('.o6cuMc, .dEOOab, .EjBTad, [role="alert"]');
  return el ? el.textContent.trim() : null;
};

/**
 * Click Google's Next button.
 * Google serves several sign-in flows: on the modern one `#identifierNext` is a
 * wrapper containing a <button>, on WebLiteSignIn `#identifierNext` IS the
 * button. Querying only `#identifierNext button` silently no-ops on the latter,
 * so try the child, then the element itself, then submit the form.
 */
const CLICK_NEXT = (wrapId) => {
  const wrap = document.getElementById(wrapId);
  if (wrap) {
    const inner = wrap.querySelector('button, [role="button"]');
    const target = inner || (wrap.tagName === 'BUTTON' || wrap.getAttribute('role') === 'button' ? wrap : null);
    if (target) { target.click(); return 'click'; }
  }
  for (const b of document.querySelectorAll('button, [role="button"]')) {
    const t = (b.innerText || '').trim().toLowerCase();
    if (b.offsetParent !== null && (t === 'next' || t === 'berikutnya' || t === 'lanjut')) { b.click(); return 'text'; }
  }
  return null;
};

// Hard stops: retrying these only burns the 90s login budget.
const FATAL_LOGIN = /couldn'?t find|tidak dapat menemukan|wrong password|password salah|incorrect password|disabled|dinonaktifkan|may not be secure|tidak aman|too many failed|try again later/i;

/** Detect Google's anti-automation wall + account-level dead ends. */
const READ_GOOGLE_BLOCK = () => {
  const txt = (document.body?.innerText || '').slice(0, 4000).toLowerCase();
  for (const k of ['this browser or app may not be secure', 'browser atau aplikasi ini mungkin tidak aman',
    'couldn’t sign you in', 'tidak dapat memproses']) {
    if (txt.includes(k)) return k;
  }
  return null;
};

const CLICK_CONSENT = (texts) => {
  for (const id of ['submit_approve_access', 'approve_button', 'confirm']) {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) { el.click(); return `id:${id}`; }
  }
  const nodes = document.querySelectorAll(
    'button, [role="button"], span[role="button"], input[type="submit"], ' +
    'span.VfPpkd-vQzf8d, div.VfPpkd-RLmnJb, [jsname="V67aGc"]',
  );
  for (const btn of nodes) {
    if (btn.offsetParent === null) continue;
    const txt = (btn.textContent || btn.value || '').toLowerCase().trim();
    if (!txt) continue;
    if (texts.some((t) => txt === t || txt.includes(t))) { btn.click(); return txt.slice(0, 40); }
  }
  return null;
};

/** Google login: email → password → ToS/consent. Multi-language (EN + ID). */
async function googleLogin(page, email, password, log = () => {}) {
  let emailDone = false;
  let pwdDone = false;

  for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt++) {
    let url = '';
    try { url = page.url(); } catch { return true; } // page gone = navigated off Google

    if (url.includes('myaccount.google.com')) { log('google: logged in', 'ok'); return true; }
    if (!url.includes('google.com') && !url.includes('google.co')) {
      log(`google: left to ${url.slice(0, 60)}`, 'ok');
      return true;
    }
    if (url.includes('unknownerror')) {
      try {
        await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 10_000 });
        await sleep(1000);
        if (page.url().includes('myaccount.google.com')) { log('google: already logged in', 'ok'); return true; }
        await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch { return false; }
      continue;
    }

    // Password step FIRST — #identifierId lingers in the DOM after navigating,
    // so checking email first would refill it and waste ~10s per account.
    if (!pwdDone && (await safeEval(page, IS_PWD_VISIBLE))) {
      log('google: password');
      try {
        let loc = page.locator('input[name="Passwd"]').first();
        if ((await loc.count()) === 0 || !(await loc.isVisible())) {
          loc = page.locator('input[type="password"]').first();
        }
        await loc.click({ force: true });
        await loc.fill(password);
        if (!(await safeEval(page, CLICK_NEXT, 'passwordNext'))) await loc.press('Enter');
        pwdDone = true;
      } catch {
        await sleep(500);
        continue;
      }
      for (let i = 0; i < 30; i++) {
        await sleep(300);
        let u = '';
        try { u = page.url(); } catch { return true; }
        if (!u.includes('accounts.google.com') && !u.includes('accounts.google.co')) {
          log('google: password accepted', 'ok');
          return true;
        }
        const err = await safeEval(page, READ_GOOGLE_ERROR);
        if (err && /wrong|salah|incorrect/i.test(err)) {
          log(`google: ${err.slice(0, 80)}`, 'err');
          return false;
        }
      }
      continue;
    }

    if (!emailDone && (await safeEval(page, IS_EMAIL_VISIBLE))) {
      log('google: email');
      try {
        const loc = page.locator('#identifierId').first();
        await loc.click({ force: true });
        await loc.fill(email);
      } catch {
        await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await sleep(500);
        const loc2 = page.locator('#identifierId').first();
        await loc2.click({ force: true });
        await loc2.fill(email);
      }
      if (!(await safeEval(page, CLICK_NEXT, 'identifierNext'))) {
        await page.locator('#identifierId').first().press('Enter').catch(() => {});
      }
      emailDone = true;
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        if (await safeEval(page, IS_PWD_VISIBLE)) break;
        const err = await safeEval(page, READ_GOOGLE_ERROR);
        if (err && /couldn|find|tidak|wrong/i.test(err)) {
          log(`google: ${err.slice(0, 80)}`, 'err');
          return false;
        }
      }
      continue;
    }

    // Consent / ToS / Workspace speedbump
    const hit = await safeEval(page, CLICK_CONSENT, CONSENT_TEXTS);
    if (hit) { log(`google: consent (${hit})`); await sleep(1200); continue; }

    // Nothing actionable on screen — bail early on hard errors instead of
    // spending the rest of the 90s budget scanning for buttons.
    const err = await safeEval(page, READ_GOOGLE_ERROR);
    if (err && FATAL_LOGIN.test(err)) { log(`google: ${err.slice(0, 90)}`, 'err'); return false; }
    const blocked = await safeEval(page, READ_GOOGLE_BLOCK);
    if (blocked) { log(`google blocked: ${blocked}`, 'err'); return false; }

    await sleep(1000);
  }
  log('google: login timeout', 'err');
  return false;
}

const CLICK_GOOGLE_BTN = () => {
  for (const b of document.querySelectorAll('button, a')) {
    if ((b.innerText || '').toLowerCase().includes('google')) { b.click(); return true; }
  }
  return false;
};

const PICK_ACCOUNT = (email) => {
  const el = document.querySelector(`[data-identifier="${email}"]`) || document.querySelector('[data-identifier]');
  if (el) { el.click(); return true; }
  return false;
};

/**
 * Register one Freebuff account with a Google account.
 * @returns {Promise<{token:string,email:string,userId:string}>}
 */
export async function registerOne({ email, password, proxy = '', headless = false, profileDir = '', log = () => {} } = {}) {
  if (!email || !password) throw new Error('email and password are required');

  log(`start ${email} proxy=${proxy || 'direct'}`);
  const device = await deviceFlow({ proxy });
  log(`device flow ok auth_code=${device.authCode.slice(0, 8)}…`, 'ok');

  const { ctx, dir } = await launchContext({ proxy, headless, profileDir, log });
  const ephemeral = !profileDir;
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.setDefaultTimeout(15_000);
    // Mask the most obvious automation tell before any page script runs.
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    log('[1/4] google login…');
    await page.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    for (let i = 0; i < 10; i++) {
      if (await safeEval(page, IS_EMAIL_VISIBLE)) break;
      await sleep(300);
    }
    if (!(await googleLogin(page, email, password, log))) throw new Error('google login failed');
    log('[1/4] google login ok', 'ok');

    log('[2/4] open codebuff login…');
    await page.goto(`${CODEBUFF_BASE}/login?auth_code=${device.authCode}`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(1500);

    log('[3/4] click "Continue with Google"…');
    if (!(await safeEval(page, CLICK_GOOGLE_BTN))) throw new Error('google button not found on codebuff login');
    await sleep(3000);

    log('[4/4] account chooser + consent…');
    let landed = false;
    for (let i = 0; i < CONSENT_ATTEMPTS; i++) {
      await sleep(1000);
      let url = '';
      try { url = page.url(); } catch { url = ''; }

      if (url.includes('codebuff.com/onboard')) { log(`landed onboard`, 'ok'); landed = true; break; }
      if (url.includes('codebuff.com') && !url.includes('google') && !url.includes('/login')) {
        log(`landed ${url.slice(0, 60)}`, 'ok'); landed = true; break;
      }
      await safeEval(page, PICK_ACCOUNT, email);
      await safeEval(page, CLICK_CONSENT, CONSENT_TEXTS);
    }
    if (!landed) log('no codebuff redirect seen — polling anyway', 'warn');
  } finally {
    await ctx.close().catch(() => {});
    // Ephemeral profiles are throwaway; keep an explicit profileDir for reuse.
    if (ephemeral) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const result = await pollToken(device, { proxy, log });
  if (!result.email) result.email = email;
  log(`done ${result.email}`, 'ok');
  return result;
}

/**
 * Register a list of accounts sequentially (Google rate-limits parallel logins
 * from one IP hard — keep this serial unless each account has its own proxy).
 * @param {Array<{email:string,password:string,proxy?:string}>} accounts
 */
export async function registerBatch(accounts, { proxy = '', headless = false, profileDir = '', log = () => {}, onStart, onResult, shouldStop } = {}) {
  const out = [];
  for (let i = 0; i < accounts.length; i++) {
    if (shouldStop?.()) { log('stopped by user', 'warn'); break; }
    const acc = accounts[i];
    await onStart?.(acc, i);
    log(`── [${i + 1}/${accounts.length}] ${acc.email} ──`);
    try {
      const r = await registerOne({ ...acc, proxy: acc.proxy || proxy, headless, profileDir, log });
      const rec = { ok: true, ...r };
      out.push(rec);
      await onResult?.(rec);
    } catch (e) {
      const rec = { ok: false, email: acc.email, error: e?.message || String(e) };
      log(`FAIL ${acc.email}: ${rec.error}`, 'err');
      out.push(rec);
      await onResult?.(rec);
    }
  }
  return out;
}

/** Parse "email:password" / "email|password" lines (batch input). */
export function parseAccountLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^([^\s:|]+@[^\s:|]+)[\s:|]+(.+)$/);
      return m ? { email: m[1], password: m[2].trim() } : null;
    })
    .filter(Boolean);
}







