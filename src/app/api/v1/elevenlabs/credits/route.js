import { elevenBudgetState, listElevenAccounts } from "@/lib/elevenlabs/service";
import { errorFromThrown, guardElevenApi, json, preflight } from "../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET");
}

/**
 * GET /v1/elevenlabs/credits — last known balance of the active account and today's
 * spend against the daily cap. Read-only: refreshing the balance stays in the dashboard.
 * API keys are never included (not even masked).
 */
export async function GET(request) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const [budget, { accounts, activeAccountId, rotationStrategy }] = await Promise.all([
      elevenBudgetState(),
      listElevenAccounts(),
    ]);
    const active = accounts.find((a) => a.id === activeAccountId) || null;
    return json({
      ...budget,
      rotationStrategy: rotationStrategy || null,
      account: active ? { id: active.id, name: active.name, enabled: active.enabled } : null,
      credits: active?.credits || null,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        enabled: a.enabled,
        remaining: a.credits?.remaining ?? null,
      })),
    });
  } catch (error) {
    return errorFromThrown(error);
  }
}
