import { NextResponse } from "next/server";
import { publicProxyManager } from "@/lib/network/publicProxyManager.js";

export const dynamic = "force-dynamic";

// GET /api/proxy-pools/public - Get public proxy pool status & active proxies
export async function GET() {
  try {
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
    const { action, maxLatencyMs, intervalMs } = body;

    if (maxLatencyMs) {
      publicProxyManager.setMaxLatency(Number(maxLatencyMs));
    }

    if (action === "scan") {
      // Trigger background scan
      publicProxyManager.screenProxies().catch(console.error);
      return NextResponse.json({
        ok: true,
        message: "Proxy screening triggered in background",
      });
    }

    if (action === "update_interval" && intervalMs) {
      publicProxyManager.startPeriodicScreening(Number(intervalMs));
      return NextResponse.json({
        ok: true,
        message: `Screening interval updated to ${intervalMs}ms`,
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
