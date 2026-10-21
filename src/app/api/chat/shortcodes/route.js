import { NextResponse } from "next/server";
import {
  listChatShortcodes,
  getChatShortcodeByTag,
  createChatShortcode,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");
    if (tag) {
      const shortcode = await getChatShortcodeByTag(tag);
      if (!shortcode) {
        return NextResponse.json({ error: `Shortcode with tag "${tag}" not found` }, { status: 404 });
      }
      return NextResponse.json({ shortcode });
    }
    const q = searchParams.get("q") || "";
    const shortcodes = await listChatShortcodes(q);
    return NextResponse.json({ shortcodes });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to list shortcodes" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const shortcode = await createChatShortcode(body || {});
    return NextResponse.json({ shortcode }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to create shortcode" }, { status: 400 });
  }
}
