import { describe, expect, it } from "vitest";
import { __test__ as visionTest } from "@/lib/oauth/services/qoderVisionSolver";
import { __test__ as captchaTest } from "@/lib/oauth/services/qoderCaptchaSolver";

describe("qoder vision solver parseGridIndices", () => {
  it("parses comma-separated indices", () => {
    expect(visionTest.parseGridIndices("0, 4, 7")).toEqual([0, 4, 7]);
  });

  it("parses array-style", () => {
    expect(visionTest.parseGridIndices("[0,4,7]")).toEqual([0, 4, 7]);
  });

  it("parses inline text and dedupes", () => {
    expect(visionTest.parseGridIndices("cells 0, 4, 7, 4")).toEqual([0, 4, 7]);
  });

  it("ignores out-of-range and non-numeric", () => {
    expect(visionTest.parseGridIndices("9, abc, -1, 2")).toEqual([2]);
  });

  it("returns empty when no matches", () => {
    expect(visionTest.parseGridIndices("none match")).toEqual([]);
  });
});

describe("qoder captcha solver type detection", () => {
  it("exposes helper exports", () => {
    expect(typeof captchaTest.detectTmdCaptchaType).toBe("function");
    expect(typeof captchaTest.captureClickCaptcha).toBe("function");
  });
});
