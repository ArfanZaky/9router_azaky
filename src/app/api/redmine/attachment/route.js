import { NextResponse } from "next/server";
import { getRedmineConfig } from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");
    const attachmentId = searchParams.get("id");

    const config = await getRedmineConfig();
    if (!config.apiKey) {
      return new NextResponse("Redmine API key missing", { status: 401 });
    }

    let fetchUrl = "";
    if (targetUrl) {
      // Validate that targetUrl starts with redmine baseUrl
      if (!targetUrl.startsWith(config.baseUrl)) {
        return new NextResponse("Forbidden target url", { status: 403 });
      }
      fetchUrl = targetUrl;
    } else if (attachmentId) {
      fetchUrl = `${config.baseUrl}/attachments/download/${attachmentId}`;
    } else {
      return new NextResponse("Missing url or id parameter", { status: 400 });
    }

    const res = await fetch(fetchUrl, {
      headers: {
        "X-Redmine-API-Key": config.apiKey,
      },
    });

    if (!res.ok) {
      return new NextResponse(`Failed to fetch attachment from Redmine: ${res.statusText}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const cacheControl = "public, max-age=3600, immutable";
    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
      },
    });
  } catch (err) {
    return new NextResponse(err.message, { status: 500 });
  }
}
