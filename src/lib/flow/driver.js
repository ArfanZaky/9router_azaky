// Flow browser driver.
//
// Contract (src/lib/flow/bridge.js calls this):
//   renderFlowJob(job, { onStep }) -> { mediaPath, sourceUrl }
//   readFlowCredits()              -> number
//
// Flow's submit is reCAPTCHA-gated with a single-use token, so a plain HTTP call
// is impossible: the request has to come from the signed-in web app. Writing
// that automation a second time would mean re-deriving every Flow selector and
// wait condition, and the `gflow` CLI already owns exactly that work — same
// profile, same project handling, download included (proven end-to-end: t2v 10s
// omni-flash, 15 credits, 6.7 MB mp4).
//
// So P1 drives the CLI as a subprocess. What the CLI cannot do is attach an
// existing image to the composer (`i2v`/`r2v` are unported on the agent-only
// flow.google.com host, issue #799) — that is P2 and needs real DOM work here.
// Until then i2v fails loudly before anything is submitted.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";

const BIN = () => process.env.FLOW_GFLOW_BIN || "gflow";
const RENDER_TIMEOUT_MS = () => Number(process.env.FLOW_RENDER_TIMEOUT_MS) || 15 * 60 * 1000;
const CREDIT_TIMEOUT_MS = () => Number(process.env.FLOW_CREDIT_TIMEOUT_MS) || 3 * 60 * 1000;

// This account runs on the agent-only flow.google.com composer, which has no
// resolution control: passing --resolution there aborts pre-submit (exit 11,
// "an explicit resolution is not ported"). Flow then renders its own default
// (720p for omni-flash), which is what src/lib/flow/bridge.js prices.

// Every render costs real credits. A stray `vitest run` must never pay for one,
// so the opt-in env var is required whenever a test runner is present.
function assertNotTestRun() {
  const inTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
  if (inTest && process.env.RUN_FLOW !== "1") {
    throw new Error("Refusing to render Flow inside a test run (set RUN_FLOW=1 to opt in). Nothing submitted; no credits spent.");
  }
}

function outDir() {
  const dir = process.env.FLOW_OUT_DIR || join(process.cwd(), "tmp", "flow_out");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run the CLI, collect stdout/stderr, never reject on a non-zero exit. */
function runCli(args, { timeoutMs = RENDER_TIMEOUT_MS(), logFile = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    // shell:false on purpose: spawn() escapes nothing, so a prompt with spaces
    // or quotes reaches the CLI as one argv entry.
    const child = spawn(BIN(), args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // The renderer may already be working; kill the tree so the profile lock
      // is released for the next job.
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\nspawn failed: ${error.message}`, timedOut, ms: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (logFile) {
        try {
          writeFileSync(
            logFile,
            `# gflow ${args[0]} ${args[1] || ""}\nexit=${code} timedOut=${timedOut} ms=${Date.now() - started}\n# stdout\n${stdout}\n# stderr\n${stderr}\n`
          );
        } catch {
          /* a missing debug log must never fail a paid render */
        }
      }
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}

/** `--json` emits one object; tolerate banner lines or Rich leftovers. */
export function parseCliJson(stdout = "") {
  const text = String(stdout).trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to a brace scan */
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Depth-first search for the first string value under a key matching `re`. */
function findString(node, re, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findString(item, re, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && re.test(key) && value.trim()) return value;
    const hit = findString(value, re, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Pull the saved file + remote URL out of whatever shape the CLI emits. */
export function extractRenderResult(stdout = "", outFile = null) {
  const json = parseCliJson(stdout) || {};
  let mediaPath = findString(json, /media_?path|video_?path|local_?path|output_?path|^path$|file ?path/i);
  if (mediaPath && !isAbsolute(mediaPath) && outFile) mediaPath = join(outDir(), mediaPath);
  // -o is authoritative: whatever the CLI printed, the file it wrote is the answer.
  if (outFile && existsSync(outFile)) mediaPath = outFile;

  let sourceUrl = findString(json, /^(url|video_?url|source_?url|download_?url|media_?url)$/i);
  if (!sourceUrl) {
    const match = String(stdout).match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i);
    if (match) sourceUrl = match[0];
  }
  return { mediaPath: mediaPath || null, sourceUrl: sourceUrl || null, raw: json };
}

function fail(message) {
  const error = new Error(message);
  error.flowDriver = true;
  return error;
}

/**
 * Render one job on the signed-in Flow profile.
 * Submits at most once: a retry after a submit that may have gone out would
 * spend credits twice, so every failure path here stops instead.
 */
export async function renderFlowJob(job, { onStep = () => {} } = {}) {
  // i2v cannot go through the CLI on this host (attach-image is unported, #799),
  // so it runs on the real composer instead. t2v stays on the CLI: it is proven
  // end-to-end and downloads the mp4 itself.
  if (job.mode === "i2v") {
    assertNotTestRun();
    const { renderFlowInComposer } = await import("./composer.js");
    return renderFlowInComposer(job, { onStep });
  }
  assertNotTestRun();

  const target = join(outDir(), `${job.id}.mp4`);
  const args = [
    "video",
    "t2v",
    job.prompt,
    "--model",
    job.model,
    "--duration",
    String(job.duration),
    "--aspect",
    job.aspect,
  ];
  // --resolution is deliberately never passed: see hostResolution() above.
  if (job.projectId) args.push("--project", job.projectId);
  if (process.env.FLOW_PROFILE) args.push("--profile", process.env.FLOW_PROFILE);
  args.push("-o", target, "--json");

  onStep(`submitting ${job.model} ${job.duration}s ${job.aspect}${job.resolution ? ` at Flow default (${job.resolution})` : ""}`);
  const logFile = join(outDir(), `${job.id}.log`);
  const result = await runCli(args, { logFile });

  if (result.timedOut) {
    throw fail(
      `Flow did not finish within ${Math.round(RENDER_TIMEOUT_MS() / 60000)} min and the browser was killed (known freeze race). The job may still have been submitted: check https://flow.google.com before retrying, a second submit spends credits twice. Log: ${logFile}`
    );
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim().split("\n").slice(-3).join(" | ").slice(0, 500);
    throw fail(`gflow exited ${result.code}: ${detail || "no output"} (log: ${logFile})`);
  }

  onStep("downloading");
  const { mediaPath, sourceUrl, raw } = extractRenderResult(result.stdout, target);
  // gflow can exit 0 with a per-generation failure inside the payload.
  if (raw?.succeeded === false) {
    const why = (raw.failure_reasons || []).join("; ") || raw.error_message || "no reason given";
    throw fail(`Flow rejected the render: ${why} (log: ${logFile})`);
  }
  if (!mediaPath) {
    throw fail(`Flow reported success but no mp4 was found (log: ${logFile})`);
  }
  return { mediaPath, sourceUrl };
}

/**
 * Read the balance Flow itself shows in the account menu. Spends no credits but
 * launches a browser (~10s), so callers refresh once per finished job rather
 * than per poll.
 */
export async function readFlowCredits() {
  const args = ["credits", "user"];
  if (process.env.FLOW_PROFILE) args.push("--profile", process.env.FLOW_PROFILE);
  const result = await runCli(args, { timeoutMs: CREDIT_TIMEOUT_MS() });
  const text = `${result.stdout}\n${result.stderr}`;
  const match = text.match(/Credits:\s*([0-9][0-9,]*)/i);
  if (result.code !== 0 || !match) {
    throw fail(
      `Could not read Flow credits (exit ${result.code}): ${text.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`
    );
  }
  return Number(match[1].replace(/,/g, ""));
}
