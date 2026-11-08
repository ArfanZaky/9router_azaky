import { NextResponse } from "next/server";
import { getFlowConfig, saveFlowConfig, flowPriceTable } from "@/lib/flow/bridge";
import { getFlowDiagnostics } from "@/lib/flow/driver";
import { getFlowStatsSummary } from "@/lib/db/repos/flowRepo";
import { profileDir } from "@/lib/flow/composer";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeDoctor = searchParams.get("doctor") === "1";
    const config = await getFlowConfig();
    const [stats, diag] = await Promise.all([
      getFlowStatsSummary(),
      includeDoctor ? getFlowDiagnostics(config.activeProfile || null) : Promise.resolve(null),
    ]);
    const catalog = flowPriceTable();
    return NextResponse.json({
      config,
      runtime: {
        activeProfileDir: profileDir(config.activeProfile || ""),
        gflowBin: process.env.FLOW_GFLOW_BIN || "gflow",
        outDir: process.env.FLOW_OUT_DIR || "tmp/flow_out",
        envOverrides: {
          FLOW_PROFILE: process.env.FLOW_PROFILE || null,
          FLOW_DAILY_BUDGET_CREDITS: process.env.FLOW_DAILY_BUDGET_CREDITS || null,
          FLOW_HOST_RESOLUTION: process.env.FLOW_HOST_RESOLUTION || null,
          FLOW_HEADLESS: process.env.FLOW_HEADLESS || null,
          FLOW_CHANNEL: process.env.FLOW_CHANNEL || null,
          FLOW_PROJECT_ID: process.env.FLOW_PROJECT_ID || null,
          FLOW_BRIDGE_DRYRUN: process.env.FLOW_BRIDGE_DRYRUN || null,
        },
      },
      limits: catalog.limits,
      models: catalog.models,
      imageModels: catalog.imageModels,
      stats,
      diagnostics: diag,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const updated = await saveFlowConfig(body);
    return NextResponse.json({ ok: true, config: updated });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}
