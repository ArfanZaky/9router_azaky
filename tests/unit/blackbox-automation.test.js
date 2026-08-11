import { describe, expect, it } from "vitest";
import { generateEmail, extractOtp, waitForOtp } from "@/lib/oauth/services/catchmailClient";
import { __test__ as blackboxTest } from "@/lib/oauth/services/blackboxAutomation";
import { getBlackboxBulkImportManager, BLACKBOX_BULK_IMPORT_MAX_CONCURRENCY } from "@/lib/oauth/services/blackboxBulkImportManager";

describe("blackbox catchmail client", () => {
  it("generates a valid temp email", () => {
    const email = generateEmail("random");
    expect(email).toMatch(/^[a-z]+\w*@(catchmail\.io|mailistry\.com|zeppost\.com)$/);
  });

  it("extracts a 6-digit OTP only from the message body", () => {
    const full = {
      id: "1234567890",
      body: { text: "Your Blackbox code is 483920. It expires soon." },
    };
    expect(extractOtp(full)).toBe("483920");
  });

  it("returns null when no OTP is in the body", () => {
    expect(extractOtp({ body: { text: "no code here" } })).toBeNull();
    expect(extractOtp({ body: { html: "still nothing" } })).toBeNull();
    expect(extractOtp({ body: null })).toBeNull();
  });

  it("waitForOtp throws a typed timeout error when no code arrives", async () => {
    await expect(waitForOtp("nobody@catchmail.io", { timeoutMs: 50, intervalMs: 10 }))
      .rejects.toMatchObject({ code: "CATCHMAIL_OTP_TIMEOUT" });
  });
});

describe("blackbox automation helpers", () => {
  it("extracts an sk- key from arbitrary page text", () => {
    expect(blackboxTest.extractKeyFromText("here is your key sk-abcDEF123456XYZ789 and more")).toBe("sk-abcDEF123456XYZ789");
  });

  it("generates a 16-char password", () => {
    const password = blackboxTest.generatePassword();
    expect(password).toHaveLength(16);
  });
});

describe("blackbox bulk import manager", () => {
  it("exposes the singleton getter and concurrency bounds", () => {
    const manager = getBlackboxBulkImportManager();
    expect(manager).toBeDefined();
    expect(typeof manager.startJob).toBe("function");
    expect(typeof manager.getJobWithPreview).toBe("function");
    expect(BLACKBOX_BULK_IMPORT_MAX_CONCURRENCY).toBe(8);
  });
});
