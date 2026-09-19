import { NextResponse } from "next/server";
import { publicProxyManager } from "@/lib/network/publicProxyManager.js";

export const dynamic = "force-dynamic";

// GET /api/proxy-pools/public - Get public proxy pool status & active proxies
export async function GET() {
  try {
    if (!publicProxyManager._settingsLoaded) {
      publicProxyManager._settingsLoaded = true;
      await publicProxyManager.initSettings().catch(() => {});
    }
    const stats = publicProxyManager.getStats();
    return NextResponse.json({
      ok: true,
      ...stats,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/proxy-pools/public - Trigger manual scan or update settings
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, maxLatencyMs, intervalMs, autoRescan } = body;

    if (maxLatencyMs) {
      publicProxyManager.setMaxLatency(Number(maxLatencyMs));
    }

    if (action === "scan" || autoRescan) {
      // Trigger background scan
      publicProxyManager.screenProxies().catch(console.error);
      return NextResponse.json({
        ok: true,
        message: `Proxy screening triggered in background (max latency: ${publicProxyManager.maxLatencyMs}ms)`,
        stats: publicProxyManager.getStats(),
      });
    }

    if (action === "update_latency" || action === "set_max_latency") {
      return NextResponse.json({
        ok: true,
        message: `Max latency filter updated to ${publicProxyManager.maxLatencyMs}ms`,
        stats: publicProxyManager.getStats(),
      });
    }

    if (action === "update_interval" && intervalMs) {
      publicProxyManager.startPeriodicScreening(Number(intervalMs));
      return NextResponse.json({
        ok: true,
        message: `Screening interval updated to ${intervalMs}ms`,
        stats: publicProxyManager.getStats(),
      });
    }

    return NextResponse.json({
      ok: true,
      stats: publicProxyManager.getStats(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
