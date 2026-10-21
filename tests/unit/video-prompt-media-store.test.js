import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  writeVideoAssetFile,
  getVideoFileStat,
  readVideoAssetChunk,
  resolveVideoAssetPath,
  sanitizeVideoId,
  VIDEO_MEDIA_DIR,
} from "../../src/lib/media/videoStore.js";
import { GET as getMediaRoute, HEAD as headMediaRoute } from "../../src/app/api/video-prompt/media/[id]/route.js";

describe("videoStore", () => {
  const testId = "test-video-12345";
  const dummyBuffer = Buffer.from("ftypisom00000020isomiso2mp41video_stream_mock_data_1234567890");

  beforeEach(() => {
    writeVideoAssetFile({ id: testId, buffer: dummyBuffer, ext: "mp4" });
  });

  afterEach(() => {
    const file = path.join(VIDEO_MEDIA_DIR, `${testId}.mp4`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // noop
      }
    }
  });

  it("sanitizes video IDs safely", () => {
    expect(sanitizeVideoId("../../etc/passwd")).toBe("etcpasswd");
    expect(sanitizeVideoId("valid-id_123")).toBe("valid-id_123");
  });

  it("writes and reads video file stats correctly", () => {
    const stat = getVideoFileStat(testId);
    expect(stat).not.toBeNull();
    expect(stat.size).toBe(dummyBuffer.length);
    expect(resolveVideoAssetPath(testId)).toContain(`${testId}.mp4`);
  });

  it("reads byte chunks for Range requests correctly", () => {
    const chunk = readVideoAssetChunk(testId, 0, 9);
    expect(chunk).not.toBeNull();
    expect(chunk.length).toBe(10);
    expect(chunk.total).toBe(dummyBuffer.length);
    expect(chunk.buffer.toString("utf8")).toBe("ftypisom00");
  });
});

describe("media route handler (/api/video-prompt/media/[id])", () => {
  const testId = "route-test-video-999";
  const dummyData = Buffer.from("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");

  beforeEach(() => {
    writeVideoAssetFile({ id: testId, buffer: dummyData, ext: "mp4" });
  });

  afterEach(() => {
    const file = path.join(VIDEO_MEDIA_DIR, `${testId}.mp4`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // noop
      }
    }
  });

  it("returns 200 for full video request without range", async () => {
    const req = new Request(`http://localhost/api/video-prompt/media/${testId}`);
    const res = await getMediaRoute(req, { params: Promise.resolve({ id: testId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe(String(dummyData.length));
  });

  it("returns 206 Partial Content for Range requests", async () => {
    const req = new Request(`http://localhost/api/video-prompt/media/${testId}`, {
      headers: { Range: "bytes=0-9" },
    });
    const res = await getMediaRoute(req, { params: Promise.resolve({ id: testId }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe(`bytes 0-9/${dummyData.length}`);
    expect(res.headers.get("Content-Length")).toBe("10");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString("utf8")).toBe("0123456789");
  });

  it("returns 416 for out-of-bounds Range header", async () => {
    const req = new Request(`http://localhost/api/video-prompt/media/${testId}`, {
      headers: { Range: "bytes=9999-10000" },
    });
    const res = await getMediaRoute(req, { params: Promise.resolve({ id: testId }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe(`bytes */${dummyData.length}`);
  });

  it("returns 404 for missing video", async () => {
    const req = new Request("http://localhost/api/video-prompt/media/non-existent-video-xyz");
    const res = await getMediaRoute(req, { params: Promise.resolve({ id: "non-existent-video-xyz" }) });

    expect(res.status).toBe(404);
  });

  it("sets attachment Content-Disposition when ?download=1 is requested", async () => {
    const req = new Request(`http://localhost/api/video-prompt/media/${testId}?download=1`);
    const res = await getMediaRoute(req, { params: Promise.resolve({ id: testId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment;");
    expect(res.headers.get("Content-Disposition")).toContain(`${testId}.mp4`);
  });

  it("handles HEAD requests correctly", async () => {
    const req = new Request(`http://localhost/api/video-prompt/media/${testId}`, { method: "HEAD" });
    const res = await headMediaRoute(req, { params: Promise.resolve({ id: testId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe(String(dummyData.length));
  });
});
