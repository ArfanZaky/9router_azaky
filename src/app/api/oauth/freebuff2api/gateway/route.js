import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { getSettings, updateSettings } from "@/lib/db";
import {
  getGatewayStatus,
  getGatewayAccounts,
  getGatewayQuota,
  addGatewayAccount,
  startGatewayRegister,
  getGatewayRegisterStatus,
  cancelGatewayRegister,
  startGatewayProcess,
  stopGatewayProcess,
  probeGateway,
  isGatewayManaged,
} from "@/lib/oauth/services/freebuff2apiGateway";

export const dynamic = "force-dynamic";

const DEFAULT_DIR = "F:\\project\\9router\\custom\\extensions\\freebuff2api";
const SETTING_KEY = "freebuff2apiGatewayDir";

// Resolve the active freebuff2api gateway connection config (baseUrl + apiKey).
async function resolveGatewayConfig(override) {
  if (override?.baseUrl || override?.apiKey) {
    return {
      baseUrl: override.baseUrl || "http://127.0.0.1:8787",
      apiKey: override.apiKey || "freebuff-default-key",
    };
  }
  const connections = await getProviderConnections({ provider: "freebuff2api" });
  const active = connections.find((c) => c.isActive !== false);
  return {
    baseUrl: active?.providerSpecificData?.baseUrl || "http://127.0.0.1:8787",
    apiKey: active?.apiKey || active?.accessToken || "freebuff-default-key",
  };
}

// Gateway must live inside this repo (same workspace as 9Router), never an
// external Downloads path. Stale settings pointing elsewhere are ignored.
async function resolveGatewayDir() {
  const settings = await getSettings();
  const saved = settings[SETTING_KEY];
  if (typeof saved === "string" && saved.trim() && !/Downloads|Installers/i.test(saved)) {
    return saved.trim();
  }
  return DEFAULT_DIR;
}

function parseCfg(body) {
  return {
    baseUrl: body?.baseUrl || undefined,
    apiKey: body?.apiKey || undefined,
  };
}

/**
 * GET /api/oauth/freebuff2api/gateway?baseUrl=&apiKey=
 * Returns gateway status + accounts + quota + process info in one shot.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const cfg = await resolveGatewayConfig({
      baseUrl: searchParams.get("baseUrl") || undefined,
      apiKey: searchParams.get("apiKey") || undefined,
    });
    const dir = await resolveGatewayDir();
    const alive = await probeGateway(cfg).catch(() => false);
    const [status, accounts, quota] = await Promise.all([
      getGatewayStatus(cfg).catch((e) => ({ error: e.message })),
      getGatewayAccounts(cfg).catch((e) => ({ error: e.message })),
      getGatewayQuota(cfg).catch(() => ({ scanning: true })),
    ]);
    return NextResponse.json({
      ok: true,
      baseUrl: cfg.baseUrl,
      alive,
      managed: isGatewayManaged(),
      gatewayDir: dir,
      status,
      accounts,
      quota,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}

/**
 * POST /api/oauth/freebuff2api/gateway
 * Actions:
 *   { action: "status" }                       → refresh status (same as GET)
 *   { action: "start", dir? }                  → spawn gateway server.js, wait until alive
 *   { action: "stop" }                         → stop the spawned gateway process
 *   { action: "add-account", token }           → add freebuff token to gateway pool
 *   { action: "register", batch, proxy? }      → start GSuite register job
 *   { action: "register-status" }              → register job progress
 *   { action: "register-cancel" }              → stop register job
 * All accept optional baseUrl/apiKey override.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const cfg = await resolveGatewayConfig(parseCfg(body));
    const action = body?.action || "status";

    switch (action) {
      case "status": {
        const alive = await probeGateway(cfg).catch(() => false);
        const [status, accounts, quota] = await Promise.all([
          getGatewayStatus(cfg).catch((e) => ({ error: e.message })),
          getGatewayAccounts(cfg).catch((e) => ({ error: e.message })),
          getGatewayQuota(cfg).catch(() => ({ scanning: true })),
        ]);
        return NextResponse.json({ ok: true, baseUrl: cfg.baseUrl, alive, managed: isGatewayManaged(), status, accounts, quota });
      }
      case "start": {
        const dir = String(body?.dir || "").trim() || await resolveGatewayDir();
        if (body?.dir) await updateSettings({ [SETTING_KEY]: dir });
        const result = await startGatewayProcess({ dir, port: body?.port || 8787, ...cfg });
        return NextResponse.json({ ok: true, result, gatewayDir: dir, managed: isGatewayManaged() });
      }
      case "stop": {
        const result = await stopGatewayProcess(cfg);
        return NextResponse.json({ ok: true, result, managed: isGatewayManaged() });
      }
      case "add-account": {
        const token = String(body?.token || "").trim();
        if (!token) return NextResponse.json({ ok: false, error: "token required" }, { status: 400 });
        const result = await addGatewayAccount({ token, ...cfg });
        return NextResponse.json({ ok: true, result });
      }
      case "register": {
        const batch = String(body?.batch || "").trim();
        if (!batch) return NextResponse.json({ ok: false, error: "batch required (email:password per line)" }, { status: 400 });
        const result = await startGatewayRegister({ batch, proxy: body?.proxy, ...cfg });
        return NextResponse.json({ ok: true, result });
      }
      case "register-status": {
        const result = await getGatewayRegisterStatus(cfg);
        return NextResponse.json({ ok: true, result });
      }
      case "register-cancel": {
        const result = await cancelGatewayRegister(cfg);
        return NextResponse.json({ ok: true, result });
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
