import { describe, expect, it } from "vitest";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData(qoder)", () => {
  it("parses user/organization credit quotas and drops empty org bucket", () => {
    const rows = parseQuotaData("qoder", {
      quotas: {
        user: { total: 300, used: 40, remaining: 260, unit: "credits" },
        organization: { total: 0, used: 0, remaining: 0, unit: "credits" },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Personal",
      used: 40,
      total: 300,
      unit: "credits",
    });
  });

  it("shows a claimed Qwen38 800 grant as a full one-shot quota row", () => {
    const rows = parseQuotaData("qoder", {
      quotas: { user: { total: 0, used: 0, remaining: 0, unit: "credits" } },
      activityQuotas: [
        {
          name: "Qwen38 800 calls",
          unit: "calls",
          total: 800,
          used: 0,
          remaining: 800,
          recurring: false,
          activityId: "qwen38_800_invoke",
          claimed: true,
          canClaim: false,
          reason: "",
        },
      ],
    });

    expect(rows).toHaveLength(2);
    const grant = rows.find((r) => r.name === "Qwen38 800 calls");
    expect(grant).toMatchObject({
      used: 0,
      total: 800,
      unit: "calls",
      recurring: false,
    });
    expect(grant.message).toBeUndefined();
  });

  it("marks an unclaimed-but-claimable grant as exhausted with an available hint", () => {
    const rows = parseQuotaData("qoder", {
      quotas: { user: { total: 0, used: 0, remaining: 0, unit: "credits" } },
      activityQuotas: [
        {
          name: "Qwen38 800 calls",
          unit: "calls",
          total: 800,
          used: 0,
          remaining: 0,
          recurring: false,
          activityId: "qwen38_800_invoke",
          claimed: false,
          canClaim: true,
          reason: "",
        },
      ],
    });

    const grant = rows.find((r) => r.name === "Qwen38 800 calls");
    expect(grant).toMatchObject({
      used: 800,
      total: 800,
      unit: "calls",
      recurring: false,
    });
    expect(grant.message).toMatch(/available/i);
  });

  it("marks an ineligible grant with the upstream reason", () => {
    const rows = parseQuotaData("qoder", {
      quotas: { user: { total: 0, used: 0, remaining: 0, unit: "credits" } },
      activityQuotas: [
        {
          name: "Qwen38 2000 calls",
          unit: "calls",
          total: 2000,
          used: 0,
          remaining: 0,
          recurring: false,
          activityId: "qwen38_2000_invoke",
          claimed: false,
          canClaim: false,
          reason: "USER_NOT_ELIGIBLE",
        },
      ],
    });

    const grant = rows.find((r) => r.name === "Qwen38 2000 calls");
    expect(grant).toMatchObject({ used: 2000, total: 2000, recurring: false });
    expect(grant.message).toBe("USER_NOT_ELIGIBLE");
  });

  it("ignores unknown activity quota rows", () => {
    const rows = parseQuotaData("qoder", {
      quotas: { user: { total: 0, used: 0, remaining: 0, unit: "credits" } },
      activityQuotas: [
        { name: "Unrelated", claimed: true, total: 999 },
      ],
    });

    expect(rows).toHaveLength(1);
  });
});
