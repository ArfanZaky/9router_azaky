import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// TTL constants (ms) — match client-side poll intervals
export const QUOTA_CACHE_TTL_MS = 60_000;        // 60 s (default)
export const QUOTA_CACHE_TTL_CLAUDE_MS = 180_000; // 180 s (Claude)

/**
 * Get cached quota for a connection if still within TTL.
 * @param {string} connectionId
 * @param {number} ttlMs - max age in ms
 * @returns {object|null} Parsed quota data, or null if miss/stale
 */
export async function getCachedQuota(connectionId, ttlMs = QUOTA_CACHE_TTL_MS) {
  try {
    const db = await getAdapter();
    const row = db.get(
      `SELECT data, cachedAt FROM quotaCache WHERE connectionId = ?`,
      [connectionId],
    );
    if (!row) return null;

    const age = Date.now() - new Date(row.cachedAt).getTime();
    if (age > ttlMs) return null;

    return parseJson(row.data, null);
  } catch (e) {
    console.error("[quotaCacheRepo] getCachedQuota error:", e.message);
    return null;
  }
}

/**
 * Upsert quota data for a connection.
 * @param {string} connectionId
 * @param {string} provider
 * @param {object} data - Raw quota response object
 */
export async function setCachedQuota(connectionId, provider, data) {
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO quotaCache(connectionId, provider, data, cachedAt)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(connectionId) DO UPDATE SET
         provider  = excluded.provider,
         data      = excluded.data,
         cachedAt  = excluded.cachedAt`,
      [connectionId, provider, stringifyJson(data), new Date().toISOString()],
    );
  } catch (e) {
    console.error("[quotaCacheRepo] setCachedQuota error:", e.message);
  }
}

/**
 * Get all cached quota rows for a provider, regardless of TTL.
 * Used by the summary endpoint to aggregate across all accounts.
 * @param {string} provider
 * @returns {Array<{ connectionId, data, cachedAt }>}
 */
export async function getAllCachedQuotasByProvider(provider) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT connectionId, data, cachedAt FROM quotaCache WHERE provider = ?`,
      [provider],
    );
    return rows.map((r) => ({
      connectionId: r.connectionId,
      data: parseJson(r.data, null),
      cachedAt: r.cachedAt,
    }));
  } catch (e) {
    console.error("[quotaCacheRepo] getAllCachedQuotasByProvider error:", e.message);
    return [];
  }
}

/**
 * Delete stale cache entries older than maxAgeMs (default 1 hour).
 * Call periodically to keep the table tidy.
 */
export async function pruneQuotaCache(maxAgeMs = 3_600_000) {
  try {
    const db = await getAdapter();
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    db.run(`DELETE FROM quotaCache WHERE cachedAt < ?`, [cutoff]);
  } catch (e) {
    console.error("[quotaCacheRepo] pruneQuotaCache error:", e.message);
  }
}
