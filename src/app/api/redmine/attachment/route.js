import { NextResponse } from "next/server";
import { getRedmineConfig, getRedmineIssueDetail } from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");
    let attachmentId = searchParams.get("id");
    const filename = searchParams.get("filename");
    const issueId = searchParams.get("issueId");

    const config = await getRedmineConfig();
    if (!config.apiKey) {
      return new NextResponse("Redmine API key missing", { status: 401 });
    }

    // If ID is not directly given, attempt resolution by filename and issueId
    if (!targetUrl && !attachmentId && filename && issueId) {
      try {
        const issue = await getRedmineIssueDetail(issueId);
        if (issue) {
          const lower = filename.trim().toLowerCase();
          const match = (issue.attachments || []).find(
            (a) => a.filename?.toLowerCase() === lower || a.filename?.toLowerCase().includes(lower)
          );
          if (match?.id) {
            attachmentId = String(match.id);
          } else if (Array.isArray(issue.journals)) {
            for (const j of issue.journals) {
              const d = (j.details || []).find(
                (det) => det.property === "attachment" && det.new_value?.toLowerCase() === lower
              );
              if (d?.name) {
                attachmentId = String(d.name);
                break;
              }
            }
          }
        }
      } catch {
        // continue
      }
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
      return new NextResponse("Missing url, id, or matching attachment parameter", { status: 400 });
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
