import { NextResponse } from "next/server";
import {
  getChatShortcode,
  updateChatShortcode,
  deleteChatShortcode,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const shortcode = await getChatShortcode(id);
    if (!shortcode) {
      return NextResponse.json({ error: "Shortcode not found" }, { status: 404 });
    }
    return NextResponse.json({ shortcode });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to get shortcode" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const updated = await updateChatShortcode(id, body || {});
    if (!updated) {
      return NextResponse.json({ error: "Shortcode not found" }, { status: 404 });
    }
    return NextResponse.json({ shortcode: updated });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to update shortcode" }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteChatShortcode(id);
    if (!deleted) {
      return NextResponse.json({ error: "Shortcode not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to delete shortcode" }, { status: 500 });
  }
}
