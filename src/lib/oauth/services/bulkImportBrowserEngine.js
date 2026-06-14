import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

const SUPPORTED_ENGINES = new Set(["chromium", "camoufox"]);
export const DEFAULT_BULK_IMPORT_ENGINE = "chromium";

export function normalizeBulkImportEngine(value) {
  if (typeof value !== "string") return DEFAULT_BULK_IMPORT_ENGINE;
  const lower = value.trim().toLowerCase();
  return SUPPORTED_ENGINES.has(lower) ? lower : DEFAULT_BULK_IMPORT_ENGINE;
}

function loadRuntimeHelper(name) {
  try {
    return requireFromHere(`../../../../cli/hooks/${name}`);
  } catch {
    return null;
  }
}

async function launchChromium({ proxyUrl } = {}) {
  const runtime = loadRuntimeHelper("playwrightRuntime");
  if (runtime?.ensurePlaywrightRuntime) {
    const ready = runtime.ensurePlaywrightRuntime({ silent: false });
    if (!ready.ok && ready.error) throw ready.error;
  }

  let chromium;
  try {
    const playwright = await import("playwright");
    chromium = playwright.chromium;
  } catch (err) {
    const friendly = new Error(
      `Playwright is not installed. Run "npm install -g playwright && npx playwright install chromium" or restart the bulk import to auto-install.`
    );
    friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
    friendly.cause = err;
    throw friendly;
  }

  const options = { headless: true };
  if (proxyUrl) options.proxy = { server: proxyUrl };
  return chromium.launch(options);
}

async function launchCamoufox({ proxyUrl } = {}) {
  const runtime = loadRuntimeHelper("camoufoxRuntime");
  if (!runtime?.ensureCamoufoxRuntime) {
    const err = new Error(
      `Camoufox runtime helper missing. Reinstall wyxrouter or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_RUNTIME_HELPER_MISSING";
    throw err;
  }
  const ready = runtime.ensureCamoufoxRuntime({ silent: false });
  if (!ready.ok && ready.error) throw ready.error;

  const camoufox = ready.module || runtime.loadCamoufoxModule?.();
  if (!camoufox?.launchOptions) {
    const err = new Error(
      `camoufox-js loaded but does not expose launchOptions(); reinstall the package or pick the Chromium engine.`
    );
    err.code = "CAMOUFOX_API_MISMATCH";
    throw err;
  }

  let firefox;
  try {
    const pwCore = await import("playwright-core");
    firefox = pwCore.firefox;
  } catch {
    try {
      const pw = await import("playwright");
      firefox = pw.firefox;
    } catch (err) {
      const friendly = new Error(
        `Playwright is required to drive Camoufox. Run "npm install -g playwright" or pick the Chromium engine.`
      );
      friendly.code = "PLAYWRIGHT_PACKAGE_MISSING";
      friendly.cause = err;
      throw friendly;
    }
  }

  const camoufoxOptions = await camoufox.launchOptions({ headless: true });
  const launchOptions = { ...camoufoxOptions };
  if (proxyUrl) launchOptions.proxy = { server: proxyUrl };

  return firefox.launch(launchOptions);
}

export async function launchBulkImportBrowser({ engine = DEFAULT_BULK_IMPORT_ENGINE, proxyUrl } = {}) {
  const normalized = normalizeBulkImportEngine(engine);
  if (normalized === "camoufox") {
    return launchCamoufox({ proxyUrl });
  }
  return launchChromium({ proxyUrl });
}

export function makeBrowserLauncher({ engine, proxyUrl } = {}) {
  return () => launchBulkImportBrowser({ engine, proxyUrl });
}
