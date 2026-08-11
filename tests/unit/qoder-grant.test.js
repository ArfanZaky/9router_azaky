import { describe, expect, it, vi } from "vitest";
import {
  exchangePat,
  fetchStatus,
  checkPat,
  __test__ as grantTest,
} from "@/lib/oauth/services/qoderGrantService";

describe("qoder grant service endpoints", () => {
  it("exposes the expected upstream URLs", () => {
    expect(grantTest.EXCHANGE_URL).toContain("/api/v1/jobToken/exchange");
    expect(grantTest.STATUS_URL).toContain("/api/v3/user/status");
    expect(grantTest.PLAN_URL).toContain("/api/v2/user/plan");
    expect(grantTest.QUOTA_URL).toContain("/api/v2/quota/usage");
  });
});

describe("qoder grant service exchangePat", () => {
  it("extracts the access token from the exchange response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "jt-token", refresh_token: "rt" }),
    });
    globalThis.fetch = fetchMock;

    const jt = await exchangePat("pt-test");
    expect(jt).toBe("jt-token");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).personal_token).toBe("pt-test");
  });

  it("throws when the exchange returns no token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    });
    await expect(exchangePat("pt-test")).rejects.toThrow("no token");
  });

  it("throws on non-ok HTTP", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "forbidden",
    });
    await expect(exchangePat("pt-test")).rejects.toThrow("403");
  });
});

describe("qoder grant service fetchStatus", () => {
  it("marks pro trial when credits total >= 100", async () => {
    const responses = {
      [grantTest.STATUS_URL]: { plan: "PRO_TRIAL", userType: "PROFESSIONAL_TRIAL", email: "a@b.c" },
      [grantTest.PLAN_URL]: { plan_tier_name: "PRO_TRIAL" },
      [grantTest.QUOTA_URL]: { userQuota: { total: 300, remaining: 290 } },
    };
    globalThis.fetch = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[url] || {}),
    }));

    const status = await fetchStatus("jt");
    expect(status.proTrialOk).toBe(true);
    expect(status.trialGranted).toBe(true);
    expect(status.creditsTotal).toBe(300);
    expect(status.creditsRemaining).toBe(290);
  });

  it("marks non-pro when plan is not a trial", async () => {
    const responses = {
      [grantTest.STATUS_URL]: { plan: "FREE", userType: "free" },
      [grantTest.PLAN_URL]: { plan_tier_name: "free" },
      [grantTest.QUOTA_URL]: { userQuota: { total: 20, remaining: 10 } },
    };
    globalThis.fetch = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[url] || {}),
    }));

    const status = await fetchStatus("jt");
    expect(status.proTrialOk).toBe(false);
    expect(status.creditsTotal).toBe(20);
  });

  it("tolerates upstream errors per endpoint", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === grantTest.STATUS_URL) {
        return { ok: false, status: 500, text: async () => "err" };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ userQuota: { total: 5 } }),
      };
    });
    const status = await fetchStatus("jt");
    expect(status.creditsTotal).toBe(5);
    expect(status.proTrialOk).toBe(false);
  });
});

describe("qoder grant service checkPat", () => {
  it("returns status plus the JT", async () => {
    const responses = {
      [grantTest.EXCHANGE_URL]: { token: "jt-1" },
      [grantTest.STATUS_URL]: { plan: "PRO_TRIAL", userType: "PROFESSIONAL_TRIAL" },
      [grantTest.PLAN_URL]: { plan_tier_name: "PRO_TRIAL" },
      [grantTest.QUOTA_URL]: { userQuota: { total: 200, remaining: 150 } },
    };
    globalThis.fetch = vi.fn().mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(responses[url] || {}),
    }));

    const result = await checkPat("pt-test");
    expect(result.jt).toBe("jt-1");
    expect(result.proTrialOk).toBe(true);
  });
});
