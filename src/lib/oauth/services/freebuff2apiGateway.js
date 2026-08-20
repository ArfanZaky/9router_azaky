/**
 * Freebuff2API Gateway client (server-side).
 *
 * Talks to a self-hosted freebuff2api instance (default http://127.0.0.1:8787)
 * which owns the freebuff account pool, proxy rotation, session lifecycle and
 * quota. 9Router consumes it as an OpenAI-compatible provider for chat, and uses
 * these management endpoints for automation:
 *   GET  /api/status            → gateway + account + session + model health
 *   GET  /api/accounts          → per-account state (masked tokens, health)
 *   GET  /api/quota             → per-model session quota snapshot
 *   POST /api/account           → add a freebuff token:uid to the pool
 *   POST /api/register          → start GSuite auto-register batch (Playwright)
 *   GET  /api/register/status   → register job progress
 *   POST /api/register/cancel   → stop register job
 *   POST /api/session           → force-create a session (health check)
 *   POST /api/proxy/test        → test an outbound proxy
 *
 * Process lifecycle (start/stop of server.js itself) is handled here, on the
 * 9Router side, by spawning/killing `node server.js` in the gateway folder.
 */

import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_GATEWAY = "http://127.0.0.1:8787";
const DEFAULT_API_KEY = "freebuff-default-key";

// Gateway process lifecycle state (in-memory; process dies with 9Router).
let gatewayProcess = null;

export function normalizeBaseUrl(raw) {
  const base = String(raw || "").trim().replace(/\/+$/, "");
  return base || DEFAULT_GATEWAY;
}

function buildHeaders(apiKey) {
  const key = String(apiKey || "").trim() || DEFAULT_API_KEY;
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    Accept: "application/json",
  };
}

async function gatewayFetch(path, { baseUrl, apiKey, method = "GET", body } = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const init = { method, headers: buildHeaders(apiKey) };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

/** GET /api/status — gateway health summary. */
export async function getGatewayStatus({ baseUrl, apiKey } = {}) {
  const { status, ok, data } = await gatewayFetch("/api/status", { baseUrl, apiKey });
  if (!ok) throw new Error(`gateway /api/status failed (${status}): ${data?.error || data?.message || status}`);
  return data;
}

/** GET /api/accounts — per-account state. */
export async function getGatewayAccounts({ baseUrl, apiKey } = {}) {
  const { status, ok, data } = await gatewayFetch("/api/accounts", { baseUrl, apiKey });
  if (!ok) throw new Error(`gateway /api/accounts failed (${status}): ${data?.error || data?.message || status}`);
  return data?.accounts || [];
}

/** GET /api/quota — model quota snapshot. */
export async function getGatewayQuota({ baseUrl, apiKey } = {}) {
  const { ok, data } = await gatewayFetch("/api/quota", { baseUrl, apiKey });
  if (!ok) return { scanning: true, models: [], accounts: [] };
  return data || {};
}

/** POST /api/account — add freebuff token[:uid] to the gateway pool. */
export async function addGatewayAccount({ token, baseUrl, apiKey } = {}) {
  const { status, ok, data } = await gatewayFetch("/api/account", { baseUrl, apiKey, method: "POST", body: { token } });
  if (!ok) throw new Error(`gateway add account failed (${status}): ${data?.error || data?.message || status}`);
  return data;
}

/** POST /api/register — start a GSuite auto-register batch on the gateway. */
export async function startGatewayRegister({ batch, baseUrl, apiKey, proxy } = {}) {
  const body = { batch, proxy: proxy || "", useProxyPool: !proxy };
  const { status, ok, data } = await gatewayFetch("/api/register", { baseUrl, apiKey, method: "POST", body });
  if (!ok) throw new Error(`gateway register start failed (${status}): ${data?.error || data?.message || status}`);
  return data;
}

/** GET /api/register/status — register job progress. */
export async function getGatewayRegisterStatus({ baseUrl, apiKey } = {}) {
  const { status, ok, data } = await gatewayFetch("/api/register/status", { baseUrl, apiKey });
  if (!ok) throw new Error(`gateway register status failed (${status})`);
  return data;
}

/** POST /api/register/cancel — stop a register job. */
export async function cancelGatewayRegister({ baseUrl, apiKey } = {}) {
  const { status, ok, data } = await gatewayFetch("/api/register/cancel", { baseUrl, apiKey, method: "POST", body: {} });
  if (!ok) throw new Error(`gateway register cancel failed (${status})`);
  return data;
}


/** POST /api/run — start/stop/status an agent run on the gateway. */
export async function gatewayRun({ action = "status", model, baseUrl, apiKey } = {}) {
  const body = { action };
  if (model) body.model = model;
  const { status, ok, data } = await gatewayFetch("/api/run", { baseUrl, apiKey, method: "POST", body });
  if (!ok) throw new Error(`gateway run ${action} failed (${status}): ${data?.error || data?.message || status}`);
  return data;
}
// ---------------------------------------------------------------- process ----

/** Check whether something is listening on the gateway port (probe /healthz). */
export async function probeGateway({ baseUrl, apiKey } = {}) {
  try {
    await gatewayFetch("/healthz", { baseUrl, apiKey });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the gateway server.js process (node server.js) and wait until it is
 * reachable. Runs detached so it survives 9Router restarts. Resolves the child
 * PID; never throws on spawn — errors surface via the probe result.
 */
export async function startGatewayProcess({ dir, port = 8787, baseUrl, apiKey } = {}) {
  const resolvedDir = String(dir || "").trim();
  if (!resolvedDir || !existsSync(resolvedDir)) {
    throw new Error(`gateway folder not found: ${resolvedDir || "(empty)"}`);
  }
  const entry = join(resolvedDir, "server.js");
  if (!existsSync(entry)) throw new Error(`gateway server.js not found in ${resolvedDir}`);
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    return { ok: true, alreadyRunning: true, pid: gatewayProcess.pid };
  }
  // Already up via another route (user started it manually)? Then don't double-spawn.
  if (await probeGateway({ baseUrl, apiKey })) {
    return { ok: true, alreadyRunning: true, pid: null };
  }

  const child = spawn(process.execPath, ["server.js"], {
    cwd: resolvedDir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
  });
  child.unref();
  gatewayProcess = child;
  child.once("exit", () => { if (gatewayProcess === child) gatewayProcess = null; });

  // Wait up to ~25s for /healthz to answer.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await probeGateway({ baseUrl, apiKey })) {
      return { ok: true, alreadyRunning: false, pid: child.pid };
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`gateway start timeout: not reachable on ${normalizeBaseUrl(baseUrl)} after 25s`);
}

/** Stop the gateway process we spawned (SIGTERM then SIGKILL fallback). */
export async function stopGatewayProcess({ baseUrl, apiKey } = {}) {
  const target = gatewayProcess;
  if (!target) {
    // Not ours — try a graceful /healthz-probe only; nothing to kill.
    return { ok: true, stopped: false, reason: "not managed by this app" };
  }
  try { target.kill("SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && target.exitCode === null) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (target.exitCode === null) {
    try { target.kill("SIGKILL"); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  gatewayProcess = null;
  return { ok: true, stopped: true, pid: target.pid };
}

/** True when this app spawned (and still owns) the gateway process. */
export function isGatewayManaged() {
  return Boolean(gatewayProcess && gatewayProcess.exitCode === null);
}

export const __test__ = { normalizeBaseUrl, gatewayFetch };
