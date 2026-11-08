import { NextResponse } from "next/server";
import {
  listElevenAccounts,
  addElevenAccount,
  activateElevenAccount,
  deleteElevenAccount,
  setElevenAccountEnabled,
  refreshElevenCredits,
  refreshAllElevenCredits,
  importElevenAccounts,
  moveElevenAccount,
} from "@/lib/elevenlabs/service";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

/** Accounts with masked keys only — the raw API key never leaves the server. */
export async function GET() {
  try {
    return NextResponse.json(await listElevenAccounts());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const id = String(body.id || "").trim();

    if (action === "add") {
      const res = await addElevenAccount({ name: body.name, apiKey: body.apiKey, setActive: body.setActive !== false });
      return NextResponse.json({ ok: true, ...res });
    }
    if (action === "import") {
      return NextResponse.json({ ok: true, ...(await importElevenAccounts(body.data)) });
    }
    if (action === "refresh_all") {
      return NextResponse.json({ ok: true, results: await refreshAllElevenCredits() });
    }
    if (!id) return NextResponse.json({ error: "id akun wajib diisi" }, { status: 400 });

    if (action === "use") {
      await activateElevenAccount(id);
      return NextResponse.json({ ok: true });
    }
    if (action === "enable" || action === "disable") {
      await setElevenAccountEnabled(id, action === "enable");
      return NextResponse.json({ ok: true });
    }
    if (action === "refresh_credits") {
      return NextResponse.json({ ok: true, snapshot: await refreshElevenCredits(id) });
    }
    if (action === "move") {
      await moveElevenAccount(id, body.direction === "up" ? "up" : "down");
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      await deleteElevenAccount(id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
