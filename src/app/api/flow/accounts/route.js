import { NextResponse } from "next/server";
import {
  listFlowProfiles,
  setDefaultFlowProfile,
  verifyFlowProfileStatus,
  renewFlowProfile,
  deleteFlowProfile,
  loginFlowProfile,
} from "@/lib/flow/driver";
import { getFlowConfig, saveFlowConfig, refreshFlowCredits } from "@/lib/flow/bridge";
import { getLatestFlowCreditSnapshot } from "@/lib/db/repos/flowRepo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profiles, config] = await Promise.all([listFlowProfiles(), getFlowConfig()]);
    const enriched = await Promise.all(
      profiles.map(async (p) => {
        const snap = await getLatestFlowCreditSnapshot(p.name);
        return {
          ...p,
          balance: snap?.balance ?? null,
          balanceAt: snap?.createdAt ?? null,
          isActive: config.activeProfile ? config.activeProfile === p.name : Boolean(p.is_default),
        };
      })
    );
    return NextResponse.json({
      profiles: enriched,
      activeProfile: config.activeProfile || enriched.find((p) => p.is_default)?.name || "",
      rotationStrategy: config.rotationStrategy || "active_only",
    });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    if (action === "use") {
      const profile = String(body.profile || "").trim();
      if (!profile) return NextResponse.json({ error: "Nama profil wajib diisi" }, { status: 400 });
      await setDefaultFlowProfile(profile);
      await saveFlowConfig({ activeProfile: profile });
      return NextResponse.json({ ok: true, profile });
    }

    if (action === "login") {
      const profile = String(body.profile || "").trim();
      const browser = String(body.browser || "chrome").trim();
      const account = String(body.account || "").trim();
      if (!profile) return NextResponse.json({ error: "Nama profil wajib diisi" }, { status: 400 });
      const res = await loginFlowProfile({ profile, browser, account });
      if (body.setActive !== false) {
        await setDefaultFlowProfile(profile).catch(() => {});
        await saveFlowConfig({ activeProfile: profile }).catch(() => {});
      }
      return NextResponse.json(res);
    }

    if (action === "status") {
      const profile = String(body.profile || "").trim() || null;
      const res = await verifyFlowProfileStatus(profile);
      return NextResponse.json(res);
    }

    if (action === "renew") {
      const profile = String(body.profile || "").trim() || null;
      const all = Boolean(body.all);
      const res = await renewFlowProfile(profile, { all });
      return NextResponse.json(res);
    }

    if (action === "refresh_credits") {
      const profile = String(body.profile || "").trim() || null;
      const snap = await refreshFlowCredits(profile);
      return NextResponse.json({ ok: true, snapshot: snap });
    }

    if (action === "delete" || action === "logout") {
      const profile = String(body.profile || "").trim();
      if (!profile) return NextResponse.json({ error: "Nama profil wajib diisi" }, { status: 400 });
      const res = await deleteFlowProfile(profile);
      const cfg = await getFlowConfig();
      if (cfg.activeProfile === profile) {
        const remaining = await listFlowProfiles();
        const fallback = remaining.find((p) => p.is_default)?.name || remaining[0]?.name || "";
        await saveFlowConfig({ activeProfile: fallback });
      }
      return NextResponse.json(res);
    }

    return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}
