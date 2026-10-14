import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const isWorker = process.argv.includes("--worker");

function getArgValue(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

function hasArg(flag) {
  return process.argv.includes(flag);
}

const APP_NAME = "9router";
function getDefaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function getCliToken() {
  try {
    const dataDir = process.env.DATA_DIR || getDefaultDataDir();
    const rawFile = path.join(dataDir, "machine-id");
    const secretFile = path.join(dataDir, "auth", "cli-secret");
    if (!fs.existsSync(rawFile) || !fs.existsSync(secretFile)) return null;
    const raw = fs.readFileSync(rawFile, "utf8").trim();
    const secret = fs.readFileSync(secretFile, "utf8").trim();
    return crypto.createHash("sha256").update(raw + "9r-cli-auth" + secret).digest("hex").substring(0, 16);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// MASTER PROCESS: Spawns detached worker and exits immediately (< 50ms)
// ---------------------------------------------------------------------------
if (!isWorker) {
  const logFile = path.join(rootDir, "safe-reload.log");
  const pidFile = path.join(rootDir, "safe-reload.pid");

  // Check if another safe-reload is already queued
  if (fs.existsSync(pidFile)) {
    try {
      const existingPid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (existingPid && Number.isFinite(existingPid)) {
        // Check if process is still alive
        process.kill(existingPid, 0);
        console.log(JSON.stringify({
          ok: true,
          alreadyScheduled: true,
          workerPid: existingPid,
          message: "Safe reload is already scheduled and running in background.",
        }));
        process.exit(0);
      }
    } catch {
      // Stale pid file, continue
    }
  }

  const logFd = fs.openSync(logFile, "a");
  const workerArgs = [__filename, "--worker", ...process.argv.slice(2)];

  const child = spawn(process.execPath, workerArgs, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    cwd: rootDir,
  });

  try {
    fs.writeFileSync(pidFile, String(child.pid), "utf8");
  } catch {}

  child.unref();
  try {
    fs.closeSync(logFd);
  } catch {}

  console.log(JSON.stringify({
    ok: true,
    scheduled: true,
    workerPid: child.pid,
    message: "Safe reload scheduled detached in background. Current session turn can finish completely without interruption.",
  }));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// DETACHED WORKER PROCESS: Runs independently in OS background
// ---------------------------------------------------------------------------
async function runWorker() {
  const delayMs = Number(getArgValue("--delay", "4000"));
  const timeoutMs = Number(getArgValue("--timeout", "45000"));
  const port = Number(getArgValue("--port", process.env.PORT || "2026"));
  const pm2Target = getArgValue("--pm2-id", "0");
  const force = hasArg("--force");
  const pidFile = path.join(rootDir, "safe-reload.pid");

  const log = (msg) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [safe-reload-worker] ${msg}`);
  };

  log(`Worker started (PID: ${process.pid}). Initial delay: ${delayMs}ms, Max timeout: ${timeoutMs}ms, Port: ${port}, Target: ${pm2Target}`);

  // Step 1: Wait initial delay to give current session turn time to stream final output & save DB
  if (delayMs > 0) {
    log(`Waiting initial grace period (${delayMs}ms) for active chat stream to finish...`);
    await sleep(delayMs);
  }

  // Step 2: Poll active sessions until idle (unless --force)
  if (!force) {
    const startTime = Date.now();
    const token = getCliToken();
    let isIdle = false;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const headers = token ? { "x-9r-cli-token": token } : {};
        const res = await fetch(`http://127.0.0.1:${port}/api/chat/runs`, {
          headers,
          signal: AbortSignal.timeout(3000),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const active = Array.isArray(data.activeSessions) ? data.activeSessions : [];
          if (active.length === 0) {
            log("No active sessions detected (system is idle). Safe to reload.");
            isIdle = true;
            break;
          }
          log(`Waiting for ${active.length} active session(s) to finish: [${active.join(", ")}]...`);
        } else {
          log(`Status check returned ${res.status}. Assuming server is already draining.`);
          isIdle = true;
          break;
        }
      } catch (err) {
        log(`Status check error (${err?.message || err}). Server may be stopping.`);
        isIdle = true;
        break;
      }
      await sleep(1500);
    }

    if (!isIdle) {
      log(`Timeout reached (${timeoutMs}ms). Proceeding with restart to avoid indefinite freeze.`);
    }
  }

  // Step 3: Trigger PM2 restart
  log(`Executing PM2 restart target: ${pm2Target}...`);
  try {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/sh";
    const cmd = isWin ? `npx pm2 restart ${pm2Target}` : `pm2 restart ${pm2Target}`;

    const restartProcess = spawn(shell, [isWin ? "/c" : "-c", cmd], {
      cwd: rootDir,
      stdio: "pipe",
      windowsHide: true,
    });

    restartProcess.stdout?.on("data", (d) => log(`[pm2:stdout] ${d.toString().trim()}`));
    restartProcess.stderr?.on("data", (d) => log(`[pm2:stderr] ${d.toString().trim()}`));

    await new Promise((resolve) => {
      restartProcess.on("close", (code) => {
        log(`PM2 restart finished with code: ${code}`);
        resolve();
      });
      restartProcess.on("error", (err) => {
        log(`PM2 restart execution failed: ${err.message}`);
        resolve();
      });
      setTimeout(resolve, 10000);
    });
  } catch (err) {
    log(`Failed to execute restart: ${err?.message || err}`);
  }

  // Clean up PID file
  try {
    if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
  } catch {}

  log("Worker finished successfully.");
  process.exit(0);
}

runWorker().catch((err) => {
  console.error(`[safe-reload-worker] Uncaught error:`, err);
  process.exit(1);
});
