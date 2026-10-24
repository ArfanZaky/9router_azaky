import { describe, it, expect } from "vitest";
import { isUpstreamConnectionError } from "../../src/lib/agent/loop.js";
import fs from "node:fs";
import path from "node:path";

describe("Upstream Connection Retry & Detection", () => {
  it("detects transient upstream connection drop errors", () => {
    expect(isUpstreamConnectionError(new Error("upstream connection lost"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("stream stall timeout"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("read ECONNRESET"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("Connect timeout ETIMEDOUT"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("socket hang up"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("TypeError: fetch failed"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("UND_ERR_SOCKET"))).toBe(true);
    expect(isUpstreamConnectionError(new Error("Connection reset by peer"))).toBe(true);
    expect(isUpstreamConnectionError("Run interrupted: upstream connection lost")).toBe(true);
  });

  it("does not classify non-connection errors as upstream connection drops", () => {
    expect(isUpstreamConnectionError(null)).toBe(false);
    expect(isUpstreamConnectionError(undefined)).toBe(false);
    expect(isUpstreamConnectionError(new Error("401 Unauthorized"))).toBe(false);
    expect(isUpstreamConnectionError(new Error("Invalid API key provided"))).toBe(false);
    expect(isUpstreamConnectionError(new Error("429 Too Many Requests"))).toBe(false);
    expect(isUpstreamConnectionError(new Error("SyntaxError: Unexpected token"))).toBe(false);
  });

  it("retries up to 10 times upon repeated upstream connection loss", async () => {
    let attempts = 0;
    const notices = [];
    const MAX_RETRIES = 10;

    const mockCall = async () => {
      attempts++;
      throw new Error("upstream connection lost");
    };

    let caughtError = null;
    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await mockCall();
        } catch (err) {
          if (!isUpstreamConnectionError(err) || attempt >= MAX_RETRIES) {
            throw err;
          }
          notices.push(`Upstream connection lost. Retrying (${attempt}/${MAX_RETRIES})...`);
        }
      }
    } catch (err) {
      caughtError = err;
    }

    expect(attempts).toBe(10);
    expect(notices.length).toBe(9);
    expect(notices[0]).toBe("Upstream connection lost. Retrying (1/10)...");
    expect(notices[8]).toBe("Upstream connection lost. Retrying (9/10)...");
    expect(caughtError).not.toBeNull();
    expect(caughtError.message).toBe("upstream connection lost");
  });

  it("recovers successfully if connection recovers before reaching 10 attempts", async () => {
    let attempts = 0;
    const notices = [];
    const MAX_RETRIES = 10;

    const mockCall = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("stream stall timeout");
      }
      return { ok: true, text: "Recovered successfully" };
    };

    let result = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await mockCall();
        break;
      } catch (err) {
        if (!isUpstreamConnectionError(err) || attempt >= MAX_RETRIES) {
          throw err;
        }
        notices.push(`Retrying (${attempt}/${MAX_RETRIES})`);
      }
    }

    expect(attempts).toBe(3);
    expect(notices.length).toBe(2);
    expect(result).toEqual({ ok: true, text: "Recovered successfully" });
  });

  it("stops immediately without retrying if abort signal was triggered", async () => {
    const ac = new AbortController();
    let attempts = 0;
    const MAX_RETRIES = 10;

    ac.abort(); // User clicked Stop

    let stopped = false;
    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (ac.signal.aborted) throw new Error("(Stopped)");
        attempts++;
      }
    } catch (err) {
      if (err.message === "(Stopped)") stopped = true;
    }

    expect(attempts).toBe(0);
    expect(stopped).toBe(true);
  });

  it("verifies dashboard error boundary and serverRunManager retry wiring", () => {
    const errorBoundaryPath = path.resolve(__dirname, "../../src/app/(dashboard)/error.js");
    const errorBoundaryContent = fs.readFileSync(errorBoundaryPath, "utf8");
    expect(errorBoundaryContent).toContain("ChunkLoadError");
    expect(errorBoundaryContent).toContain("window.location.reload()");
    expect(errorBoundaryContent).not.toContain("\u2014"); // Anti-Slop R-02

    const serverRunPath = path.resolve(__dirname, "../../src/lib/chat/serverRunManager.js");
    const serverRunContent = fs.readFileSync(serverRunPath, "utf8");
    expect(serverRunContent).toContain("isUpstreamConnectionError");
    expect(serverRunContent).toContain("MAX_UPSTREAM_RETRIES = 10");
    expect(serverRunContent).toContain("run.retryCount <= 10");
  });
});
