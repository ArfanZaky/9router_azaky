import { NextResponse } from "next/server";
import { getImageAsset } from "@/lib/localDb";
import { readImageFile } from "@/lib/media/imageStore.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const asset = await getImageAsset(id);
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    if (asset.path) {
      const buf = readImageFile(asset.path);
      if (buf) {
        return new Response(buf, {
          headers: {
            "Content-Type": asset.mime || "image/png",
            "Cache-Control": "private, max-age=31536000",
          },
        });
      }
    }

    if (asset.sourceUrl) {
      return NextResponse.redirect(asset.sourceUrl);
    }

    return NextResponse.json({ error: "Asset file missing" }, { status: 404 });
  } catch (error) {
    console.log("Error serving image asset:", error);
    return NextResponse.json({ error: "Failed to serve asset" }, { status: 500 });
  }
}
