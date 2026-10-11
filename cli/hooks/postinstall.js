#!/usr/bin/env node

// Postinstall: warm-up SQLite deps into ~/.9router/runtime so the first
// `9router` start doesn't need network. Failure here is non-fatal —
// cli.js will retry at runtime if anything is missing.
// `npx 9router …` (npm_command=exec) is typically a one-shot `connect` — skip
// the runtime warm-up; cli.js self-heals it if the server is started later.
if (process.env.npm_command === "exec") process.exit(0);

const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");
const { ensurePlaywrightRuntime } = require("./playwrightRuntime");
const { ensureCamoufoxRuntime } = require("./camoufoxRuntime");

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[9router] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[9router] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[9router] tray runtime skipped: ${e.message}`);
}

try {
  const result = ensurePlaywrightRuntime({ silent: false });
  if (!result?.ok) {
    console.warn(`[9router] browser automation runtime skipped: ${result?.error?.message || "Playwright unavailable"}`);
  } else {
    console.log("[9router] browser automation Chromium ready");
  }
} catch (e) {
  console.warn(`[9router] browser automation runtime skipped: ${e.message}`);
}

if (process.env.NINEROUTER_INSTALL_CAMOUFOX === "1") {
  try {
    const result = ensureCamoufoxRuntime({ silent: false });
    if (!result?.ok) {
      console.warn(`[9router] Camoufox runtime skipped: ${result?.error?.message || "Camoufox unavailable"}`);
    } else {
      console.log("[9router] Camoufox runtime ready");
    }
  } catch (e) {
    console.warn(`[9router] Camoufox runtime skipped: ${e.message}`);
  }
}

process.exit(0);
