import { describe, expect, it } from "vitest";
import {
  __test__ as signupTest,
} from "@/lib/oauth/services/qoderSignupClient";
import { getQoderSignupBulkImportManager, QODER_SIGNUP_MAX_CONCURRENCY } from "@/lib/oauth/services/qoderSignupBulkImportManager";

describe("qoder signup helpers", () => {
  it("detects baxia readiness only with long tokens", () => {
    expect(signupTest.bxReady({ "bx-ua": "x".repeat(45), "bx-umidtoken": "y".repeat(25) })).toBe(true);
    expect(signupTest.bxReady({ "bx-ua": "short", "bx-umidtoken": "y".repeat(25) })).toBe(false);
    expect(signupTest.bxReady({})).toBe(false);
  });

  it("detects TMD blocks and extracts punish URLs", () => {
    const blocked = signupTest.isTmdBlock({ ret: ["FAIL_SYS_USER_VALIDATE"], data: { url: "https://qoder.com/_____tmd_____/x" } });
    expect(blocked.blocked).toBe(true);
    expect(blocked.url).toContain("_____tmd_____");
    expect(signupTest.isTmdBlock({}).blocked).toBe(false);
  });

  it("builds a base64 captcha header", () => {
    const header = signupTest.buildCaptchaHeader({ certifyId: "cid", sceneId: "1r7eif79x", securityToken: "tok" });
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded.certifyId).toBe("cid");
    expect(decoded.securityToken).toBe("tok");
    expect(decoded.isSign).toBe(true);
  });

  it("QoderSignupHttpClient injects bx tokens and seeds cookies", () => {
    const client = new signupTest.QoderSignupHttpClient({
      tokens: { "bx-ua": "ua", "bx-umidtoken": "umid", bx_et: "et" },
      cookie: "qoder_locale=en; session=drop; keep=1",
    });
    expect(client.cookies.keep).toBe("1");
    expect(client.cookies.session).toBeUndefined();
    expect(client.tokens["bx-ua"]).toBe("ua");
  });
});

describe("qoder signup bulk import manager", () => {
  it("exposes the singleton getter and concurrency bounds", () => {
    const manager = getQoderSignupBulkImportManager();
    expect(manager).toBeDefined();
    expect(typeof manager.startJob).toBe("function");
    expect(typeof manager.getJobWithPreview).toBe("function");
    expect(QODER_SIGNUP_MAX_CONCURRENCY).toBe(8);
  });

  it("exposes the signup endpoint constants", () => {
    expect(signupTest.SIGNUP_URL).toContain("qoder.com/users/sign-up");
    expect(signupTest.PAT_URL).toContain("personal-access-tokens");
  });
});
