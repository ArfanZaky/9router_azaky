// Ensure Playwright + Chromium are usable at runtime. `npm i -g wyxrouter`
// installs the playwright npm package but does NOT trigger its postinstall
// browser download under all package managers, so the first bulk-import
// attempt fails with "Executable doesn't exist at .../chrome-headless-shell".
// We download lazily on first launch so users who never touch automation
// aren't billed ~150MB of disk.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { runNpmInstall, getRuntimeDir, getRuntimeNodeModules } = require("./sqliteRuntime");

const PLAYWRIGHT_PACKAGE = "playwright";
const PLAYWRIGHT_VERSION = "^1.54.2";

let cachedReady = null;

function tryRequirePlaywright() {
  try {
    return require(PLAYWRIGHT_PACKAGE);
  } catch {}
  try {
    const runtimeNm = getRuntimeNodeModules();
    const candidate = path.join(runtimeNm, PLAYWRIGHT_PACKAGE);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return require(candidate);
    }
  } catch {}
  return null;
}

function isChromiumBinaryAvailable() {
  const playwright = tryRequirePlaywright();
  if (!playwright?.chromium?.executablePath) return false;
  let executable;
  try {
    executable = playwright.chromium.executablePath();
  } catch {
    return false;
  }
  if (!executable) return false;
  return fs.existsSync(executable);
}

function findCli() {
  const candidates = [];
  try {
    const pwPkg = require.resolve("playwright/package.json");
    candidates.push(path.join(path.dirname(pwPkg), "cli.js"));
  } catch {}
  try {
    const pwCorePkg = require.resolve("playwright-core/package.json");
    candidates.push(path.join(path.dirname(pwCorePkg), "cli.js"));
  } catch {}
  try {
    candidates.push(path.join(getRuntimeNodeModules(), "playwright", "cli.js"));
    candidates.push(path.join(getRuntimeNodeModules(), "playwright-core", "cli.js"));
  } catch {}
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensurePlaywrightPackage({ silent = false } = {}) {
  const mod = tryRequirePlaywright();
  if (mod) return { ok: true, module: mod };

  if (!silent) console.log("⏳ Installing playwright package (first run)...");
  const installRes = runNpmInstall({
    cwd: getRuntimeDir(),
    pkgs: [`${PLAYWRIGHT_PACKAGE}@${PLAYWRIGHT_VERSION}`],
    extraArgs: ["--no-save"],
    timeout: 300_000,
  });

  if (!installRes.ok) {
    return {
      ok: false,
      reason: `npm install ${PLAYWRIGHT_PACKAGE} failed: ${installRes.stderr.split("\n").pop().slice(0, 200)}`,
    };
  }

  const installed = tryRequirePlaywright();
  if (!installed) {
    return { ok: false, reason: "playwright installed but cannot be required" };
  }
  return { ok: true, module: installed };
}

function runInstall({ silent = false, timeout = 600_000 } = {}) {
  const cliPath = findCli();
  if (!cliPath) {
    return { ok: false, reason: "playwright cli not resolvable" };
  }

  if (!silent) console.log("⏳ Downloading Playwright Chromium (first run, ~150MB)...");

  const res = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    stdio: silent ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout,
    encoding: "utf8",
  });

  if (res.status === 0) {
    if (!silent) console.log("✅ Playwright Chromium ready");
    return { ok: true };
  }

  const stderr = String(res.stderr || "");
  let reason = "unknown error";
  if (/ENOTFOUND|ETIMEDOUT|getaddrinfo/i.test(stderr)) reason = "no internet connection";
  else if (/EACCES|EPERM/i.test(stderr)) reason = "permission denied";
  else if (/ENOSPC/i.test(stderr)) reason = "not enough disk space";
  else if (stderr.trim()) reason = stderr.trim().split(/\r?\n/).pop().slice(0, 200);

  return { ok: false, reason };
}

function ensurePlaywrightRuntime({ silent = false, timeout } = {}) {
  if (cachedReady === true) return { ok: true };

  const pkg = ensurePlaywrightPackage({ silent });
  if (!pkg.ok) {
    cachedReady = false;
    const error = new Error(
      `Playwright not available. ${pkg.reason}. ` +
      `Run "npm install -g playwright && npx playwright install chromium" manually, then retry.`
    );
    error.code = "PLAYWRIGHT_PACKAGE_MISSING";
    return { ok: false, error };
  }

  if (isChromiumBinaryAvailable()) {
    cachedReady = true;
    return { ok: true, module: pkg.module };
  }

  const result = runInstall({ silent, timeout });
  if (result.ok && isChromiumBinaryAvailable()) {
    cachedReady = true;
    return { ok: true, module: pkg.module };
  }

  cachedReady = false;
  const error = new Error(
    `Playwright Chromium not available. ${result.reason}. ` +
    `Run "npx playwright install chromium" manually, then retry.`
  );
  error.code = "PLAYWRIGHT_CHROMIUM_MISSING";
  return { ok: false, error };
}

function loadPlaywrightModule() {
  return tryRequirePlaywright();
}

function resetCache() {
  cachedReady = null;
}

module.exports = {
  ensurePlaywrightRuntime,
  loadPlaywrightModule,
  isChromiumBinaryAvailable,
  resetCache,
  findPlaywrightCli: findCli,
};
