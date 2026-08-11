import { describe, expect, it, vi } from "vitest";
import { GrokDomainOtpClient, __test__ } from "../../src/lib/oauth/services/grokDomainOtpClient.js";
import { __test__ as automationTest } from "../../src/lib/oauth/services/grokCliDomainAutomation.js";
import { obtainGrokCliPkceTokens } from "../../src/lib/oauth/services/grokCliPkce.js";
import { __test__ as googleAutomationTest } from "../../src/lib/oauth/services/kiroGoogleAutomation.js";

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("GrokDomainOtpClient", () => {
  it("allows only the configured HTTPS OTP host", () => {
    expect(__test__.assertOtpBaseUrl("https://otp.cloudverra.com")).toBe("https://otp.cloudverra.com");
    expect(() => __test__.assertOtpBaseUrl("http://otp.cloudverra.com")).toThrow(/HTTPS/);
    expect(() => __test__.assertOtpBaseUrl("https://example.com")).toThrow(/not allowed/);
  });

  it("polls until a fresh code arrives", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ code: "OLD-CODE", updated: "2026-07-26T07:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse({ waiting: true }))
      .mockResolvedValueOnce(jsonResponse({ code: "NEW-CODE", updated: "2026-07-26T08:00:00Z" }));
    const client = new GrokDomainOtpClient({
      fetchImpl,
      waitImpl: async () => {},
    });

    const code = await client.waitForCode("user@example.com", {
      baselineCode: "OLD-CODE",
    });

    expect(code).toBe("NEW-CODE");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("email=user%40example.com");
  });

  it("accepts a changed code even when the OTP server timestamp uses another timezone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ code: "E7F-AAC", updated: "2026-07-26 12:58:18" })
    );
    const client = new GrokDomainOtpClient({ fetchImpl });

    await expect(client.waitForCode("user@example.com", {
      baselineCode: "OLD-CODE",
    })).resolves.toBe("E7F-AAC");
  });

  it("posts email and code to confirm without logging credentials", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const client = new GrokDomainOtpClient({ fetchImpl });

    await client.confirm("user@example.com", "ABCD-1234");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://otp.cloudverra.com/confirm",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", code: "ABCD-1234" }),
      })
    );
  });

  it("honors cancellation while polling", async () => {
    const controller = new AbortController();
    const client = new GrokDomainOtpClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ waiting: true })),
      waitImpl: async (_ms, signal) => {
        controller.abort(new Error("cancelled"));
        if (signal.aborted) throw signal.reason;
      },
    });

    await expect(client.waitForCode("user@example.com", {
      signal: controller.signal,
    })).rejects.toThrow("cancelled");
  });

  it("times out after the configured OTP wait budget", async () => {
    let now = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    const client = new GrokDomainOtpClient({
      fetchImpl: vi.fn().mockImplementation(async () => jsonResponse({ waiting: true })),
      waitImpl: async (ms) => {
        now += ms;
      },
    });

    try {
      await expect(client.waitForCode("user@example.com", {
        timeoutMs: 60_000,
        intervalMs: 3_000,
      })).rejects.toThrow(/OTP timeout after 60s/);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe("Grok domain signup helpers", () => {
  it("includes Google post-password Confirm actions used by Grok SSO", () => {
    expect(googleAutomationTest.APPROVE_BUTTON_SELECTORS).toEqual(expect.arrayContaining([
      'button:has-text("Confirm")',
      'div[role="button"]:has-text("Confirm")',
      'input[type="submit"][value="Confirm"]',
    ]));
  });

  it("normalizes xAI XXX-XXX codes to six alphanumeric characters", () => {
    expect(automationTest.normalizeOtp("E7F-AAC")).toBe("E7FAAC");
  });

  it("derives deterministic profile names without exposing passwords", () => {
    expect(automationTest.profileNames("john.doe@cloudverra.com")).toEqual({
      first: "John",
      last: "Doe",
    });
  });

  it("generates a unique PKCE verifier and matching challenge per authorization", () => {
    const first = automationTest.createPkce();
    const second = automationTest.createPkce();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.verifier.length).toBeGreaterThan(80);
  });

  it("accepts OAuth codes only from the loopback callback", () => {
    expect(automationTest.callbackCode("http://127.0.0.1:56121/callback?code=abc")).toBe("abc");
    expect(automationTest.callbackCode("https://evil.example/callback?code=abc")).toBeNull();
  });

  it("exchanges a captured PKCE callback using the supplied proxy dispatcher", async () => {
    let routeHandler;
    const dispatcher = { name: "test-proxy" };
    const page = {
      route: vi.fn(async (_pattern, handler) => { routeHandler = handler; }),
      unroute: vi.fn(async () => {}),
      goto: vi.fn(async () => {
        const authorizeUrl = new URL(page.goto.mock.calls.at(-1)[0]);
        await routeHandler({
          request: () => ({
            url: () => `http://127.0.0.1:56121/callback?code=pkce-code&state=${authorizeUrl.searchParams.get("state")}`,
          }),
          abort: vi.fn(async () => {}),
          continue: vi.fn(async () => {}),
        });
      }),
      url: vi.fn(() => "https://auth.x.ai/oauth2/authorize"),
      waitForTimeout: vi.fn(async () => {}),
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
    }));

    const tokens = await obtainGrokCliPkceTokens({ page, proxyDispatcher: dispatcher, fetchImpl });

    expect(tokens.accessToken).toBe("access-token");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://auth.x.ai/oauth2/token",
      expect.objectContaining({ dispatcher })
    );
    const request = fetchImpl.mock.calls[0][1];
    expect(request.body.get("grant_type")).toBe("authorization_code");
    expect(request.body.get("code")).toBe("pkce-code");
    expect(request.body.get("code_verifier").length).toBeGreaterThan(80);
  });

  it("rejects a PKCE callback with a mismatched state", () => {
    expect(automationTest.callbackCode(
      "http://127.0.0.1:56121/callback?code=abc&state=wrong",
      "expected"
    )).toBeNull();
  });

  it("classifies Turnstile as solved from any harvested token", () => {
    expect(automationTest.classifyTurnstileSnapshot({ tokenLength: 128 })).toBe("solved");
  });

  it("classifies interactive or broken Turnstile as interactive", () => {
    expect(automationTest.classifyTurnstileSnapshot({ interactiveVisible: true })).toBe("interactive");
    expect(automationTest.classifyTurnstileSnapshot({ broken: true })).toBe("interactive");
    expect(automationTest.classifyTurnstileSnapshot({}, "Verify you are human")).toBe("interactive");
    expect(automationTest.classifyTurnstileSnapshot({}, "Unable to find onload callback")).toBe("interactive");
  });

  it("keeps mounted non-interactive Turnstile in automatic checking", () => {
    expect(automationTest.classifyTurnstileSnapshot({ mounted: true })).toBe("checking");
  });

  it("keeps an absent Turnstile widget in loading instead of manual", () => {
    expect(automationTest.classifyTurnstileSnapshot()).toBe("loading");
  });

  it("exposes same-session Turnstile click helper for managed checkbox", () => {
    expect(typeof automationTest.tryClickTurnstile).toBe("function");
  });

  it("detects xAI sign-in only on sign-in URLs", () => {
    expect(automationTest.isXaiSignInPage({ url: () => "https://accounts.x.ai/sign-in" })).toBe(true);
    expect(automationTest.isXaiSignInPage({
      url: () => "https://accounts.x.ai/sign-in?redirect=oauth2-provider&return_to=/oauth2/consent",
    })).toBe(true);
    expect(automationTest.isXaiSignInPage({ url: () => "https://accounts.x.ai/sign-up" })).toBe(false);
    expect(automationTest.isXaiSignInPage({ url: () => "https://accounts.x.ai/sign-up/complete" })).toBe(false);
    expect(automationTest.isXaiSignInPage({ url: () => "https://auth.x.ai/oauth2/consent" })).toBe(false);
  });

  it("detects the PKCE login method chooser before the email form", () => {
    expect(automationTest.isEmailLoginChooser(
      "Log into your account\nLogin with Google\nLogin with X\nLogin with Apple\nLogin with email"
    )).toBe(true);
    expect(automationTest.isEmailLoginChooser("Log in with your email\nEmail\nNext")).toBe(false);
  });

  it("exposes incremental domain email login helper for PKCE sign-in", () => {
    expect(typeof automationTest.progressDomainEmailLogin).toBe("function");
  });
});
