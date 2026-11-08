// ElevenLabs Studio — the server side of /dashboard/elevenlabs.
//
// Accounts are ordinary providerConnections rows (provider = "elevenlabs",
// authType = "apikey"), so a key added here also serves /v1/audio/speech.
// Config lives in settings.elevenlabsConfig, history + credit snapshots in
// the elevenlabsJobs / elevenlabsCreditSnapshots tables.
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { publicProxyManager } from "@/lib/network/publicProxyManager.js";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";
import {
  getProviderConnections,
  getProviderConnectionById,
  createProviderConnection,
  updateProviderConnection,
  deleteProviderConnection,
} from "@/lib/db/repos/connectionsRepo.js";
import {
  createElevenJob,
  getElevenJobRow,
  deleteElevenJob,
  sumElevenCostSince,
  insertElevenCreditSnapshot,
  getLatestElevenCreditSnapshot,
  deleteElevenCreditSnapshots,
} from "@/lib/db/repos/elevenlabsRepo.js";

export const PROVIDER_ID = "elevenlabs";
const API_BASE = "https://api.elevenlabs.io";
export const AUDIO_DIR = path.join(DATA_DIR, "elevenlabs", "audio");

export const OUTPUT_FORMATS = [
  { value: "mp3_44100_128", label: "MP3 44.1 kHz · 128 kbps", ext: "mp3", mime: "audio/mpeg" },
  { value: "mp3_44100_192", label: "MP3 44.1 kHz · 192 kbps (Creator+)", ext: "mp3", mime: "audio/mpeg" },
  { value: "mp3_44100_64", label: "MP3 44.1 kHz · 64 kbps", ext: "mp3", mime: "audio/mpeg" },
  { value: "mp3_22050_32", label: "MP3 22 kHz · 32 kbps", ext: "mp3", mime: "audio/mpeg" },
  { value: "opus_48000_128", label: "Opus 48 kHz · 128 kbps", ext: "ogg", mime: "audio/ogg" },
];
const FORMAT_BY_VALUE = new Map(OUTPUT_FORMATS.map((f) => [f.value, f]));

// Used when GET /v1/models is unreachable. Rates from the live endpoint (2026-11).
const FALLBACK_MODELS = [
  { id: "eleven_v4", name: "Eleven v4", costMultiplier: 1, maxChars: 10000 },
  { id: "eleven_v4_turbo", name: "Eleven v4 Turbo", costMultiplier: 0.5, maxChars: 10000 },
  { id: "eleven_v3", name: "Eleven v3", costMultiplier: 1, maxChars: 5000 },
  { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", costMultiplier: 1, maxChars: 10000 },
  { id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", costMultiplier: 0.5, maxChars: 40000 },
  { id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5", costMultiplier: 0.5, maxChars: 40000 },
];

const DEFAULT_CONFIG = {
  activeAccountId: "",
  rotationStrategy: "active_only", // "active_only" | "fallback" | "round_robin"
  dailyBudgetCredits: 0, // 0 = no daily cap
  minRemainingCredits: 0, // skip an account whose known balance would drop below this
  defaultModel: "eleven_v4",
  defaultVoiceId: "JBFqnCBsd6RMkjVDRZzb", // "George", the docs' example voice
  defaultOutputFormat: "mp3_44100_128",
  defaultLanguageCode: "id", // "" = let the model detect it
  // Route ElevenLabs API calls through the screened public proxy pool (/dashboard/proxy-pools).
  autoSwitchActive: true, // fallback mode: make the account that served the request the new active one
  usePublicProxy: false,
  publicProxyFallbackDirect: false, // when every proxy fails: go direct (true) or fail (false)
  publicProxyMaxAttempts: 3,
  voiceSettings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 },
};
const STRATEGIES = ["active_only", "fallback", "round_robin"];
const LANG_RE = /^[a-z]{2,3}$/;

export class ElevenRequestError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = "ElevenRequestError";
    this.status = status;
    this.code = code;
  }
}

const clamp = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// ─── Config ──────────────────────────────────────────────────────────────

export async function getElevenConfig() {
  let stored = {};
  try {
    stored = (await getSettings())?.elevenlabsConfig || {};
  } catch {
    stored = {};
  }
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    voiceSettings: { ...DEFAULT_CONFIG.voiceSettings, ...(stored.voiceSettings || {}) },
  };
}

export async function saveElevenConfig(patch = {}) {
  const cur = await getElevenConfig();
  const vs = patch.voiceSettings || {};
  const next = {
    activeAccountId: patch.activeAccountId !== undefined ? String(patch.activeAccountId || "") : cur.activeAccountId,
    rotationStrategy: STRATEGIES.includes(patch.rotationStrategy) ? patch.rotationStrategy : cur.rotationStrategy,
    dailyBudgetCredits:
      patch.dailyBudgetCredits !== undefined ? Math.max(0, Math.floor(Number(patch.dailyBudgetCredits) || 0)) : cur.dailyBudgetCredits,
    minRemainingCredits:
      patch.minRemainingCredits !== undefined ? Math.max(0, Math.floor(Number(patch.minRemainingCredits) || 0)) : cur.minRemainingCredits,
    defaultModel: patch.defaultModel ? String(patch.defaultModel).slice(0, 80) : cur.defaultModel,
    defaultVoiceId: patch.defaultVoiceId ? String(patch.defaultVoiceId).slice(0, 80) : cur.defaultVoiceId,
    defaultOutputFormat: FORMAT_BY_VALUE.has(patch.defaultOutputFormat) ? patch.defaultOutputFormat : cur.defaultOutputFormat,
    defaultLanguageCode:
      patch.defaultLanguageCode !== undefined && (patch.defaultLanguageCode === "" || LANG_RE.test(patch.defaultLanguageCode))
        ? patch.defaultLanguageCode
        : cur.defaultLanguageCode,
    autoSwitchActive: patch.autoSwitchActive !== undefined ? Boolean(patch.autoSwitchActive) : cur.autoSwitchActive,
    usePublicProxy: patch.usePublicProxy !== undefined ? Boolean(patch.usePublicProxy) : cur.usePublicProxy,
    publicProxyFallbackDirect:
      patch.publicProxyFallbackDirect !== undefined ? Boolean(patch.publicProxyFallbackDirect) : cur.publicProxyFallbackDirect,
    publicProxyMaxAttempts:
      patch.publicProxyMaxAttempts !== undefined
        ? Math.min(10, Math.max(1, Math.floor(Number(patch.publicProxyMaxAttempts) || 3)))
        : cur.publicProxyMaxAttempts,
    voiceSettings: {
      stability: clamp(vs.stability, 0, 1, cur.voiceSettings.stability),
      similarity_boost: clamp(vs.similarity_boost, 0, 1, cur.voiceSettings.similarity_boost),
      style: clamp(vs.style, 0, 1, cur.voiceSettings.style),
      use_speaker_boost: vs.use_speaker_boost !== undefined ? Boolean(vs.use_speaker_boost) : cur.voiceSettings.use_speaker_boost,
      speed: clamp(vs.speed, 0.7, 1.2, cur.voiceSettings.speed),
    },
  };
  await updateSettings({ elevenlabsConfig: next });
  return getElevenConfig();
}

// ─── Upstream calls ──────────────────────────────────────────────────────

async function readError(res) {
  const body = await res.json().catch(() => ({}));
  const detail = body?.detail;
  const status = typeof detail === "object" ? detail?.status || detail?.code : null;
  const message =
    (typeof detail === "object" ? detail?.message : typeof detail === "string" ? detail : null) ||
    `ElevenLabs HTTP ${res.status}`;
  return { status, message: String(message).slice(0, 400) };
}

async function directFetch(apiKey, pathname, init) {
  return fetch(`${API_BASE}${pathname}`, {
    method: init.method,
    body: init.body,
    headers: { "xi-api-key": apiKey, ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeoutMs || 30000),
  });
}

/** Display form of a proxy URL: host:port only, never credentials. */
export function proxyLabel(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  } catch {
    return "proxy";
  }
}

// Status codes a forward proxy returns about itself, not about ElevenLabs.
const PROXY_FAILURE_STATUS = new Set([403, 407, 502, 503, 504]);

async function proxiedFetch(apiKey, pathname, init, cfg) {
  if (!publicProxyManager._settingsLoaded) {
    publicProxyManager._settingsLoaded = true;
    await publicProxyManager.initSettings().catch(() => {});
  }
  const tried = [];
  for (let i = 0; i < cfg.publicProxyMaxAttempts; i += 1) {
    const url = publicProxyManager.getNextProxy();
    if (!url) break;
    // undici's ProxyAgent speaks HTTP CONNECT only; socks entries are skipped.
    if (!/^https?:\/\//i.test(url)) {
      tried.push(`${proxyLabel(url)} (socks dilewati)`);
      continue;
    }
    const dispatcher = new ProxyAgent({ uri: url });
    try {
      const res = await undiciFetch(`${API_BASE}${pathname}`, {
        method: init.method,
        body: init.body,
        headers: { "xi-api-key": apiKey, ...(init.headers || {}) },
        dispatcher,
        signal: AbortSignal.timeout(init.timeoutMs || 30000),
      });
      // A proxy error page is not an ElevenLabs answer: drop the proxy, try the next one.
      const fromEleven = res.headers.get("request-id") || res.headers.get("x-trace-id") || res.headers.get("content-type")?.includes("json") || res.ok;
      if (PROXY_FAILURE_STATUS.has(res.status) && !fromEleven) {
        publicProxyManager.reportFailure(url);
        tried.push(`${proxyLabel(url)} (HTTP ${res.status})`);
        continue;
      }
      res.viaProxy = proxyLabel(url);
      return res;
    } catch (e) {
      publicProxyManager.reportFailure(url);
      tried.push(`${proxyLabel(url)} (${String(e?.cause?.code || e?.name || e?.message || "error")})`);
    }
  }
  if (cfg.publicProxyFallbackDirect) {
    const res = await directFetch(apiKey, pathname, init);
    res.viaProxy = null;
    return res;
  }
  throw new ElevenRequestError(
    tried.length
      ? `Semua public proxy gagal: ${tried.join(", ")}. Coba lagi, scan ulang proxy di Proxy Pools, atau aktifkan fallback koneksi langsung.`
      : "Belum ada public proxy yang lolos screening. Jalankan scan di halaman Proxy Pools atau matikan public proxy.",
    502,
    "proxy_unavailable"
  );
}

async function elevenFetch(apiKey, pathname, init = {}) {
  const cfg = init.config || (await getElevenConfig());
  if (cfg.usePublicProxy) return proxiedFetch(apiKey, pathname, init, cfg);
  return directFetch(apiKey, pathname, init);
}

/** GET /v1/user/subscription. Returns { ok, snapshot } or { ok:false, code, message }. */
async function fetchSubscription(apiKey) {
  const res = await elevenFetch(apiKey, "/v1/user/subscription");
  if (!res.ok) {
    const err = await readError(res);
    return { ok: false, httpStatus: res.status, code: err.status, message: err.message };
  }
  const data = await res.json();
  return {
    ok: true,
    data: {
      tier: data.tier || null,
      characterCount: Number(data.character_count) || 0,
      characterLimit: Number(data.character_limit) || 0,
      nextResetUnix: data.next_character_count_reset_unix ?? null,
    },
  };
}

const modelsCache = new Map(); // apiKey -> { time, models }
const MODELS_TTL = 60 * 60 * 1000;

export async function listElevenModels(accountId = null) {
  const conn = await resolveAccount(accountId).catch(() => null);
  if (!conn) return { models: FALLBACK_MODELS, source: "fallback" };
  const cached = modelsCache.get(conn.apiKey);
  if (cached && Date.now() - cached.time < MODELS_TTL) return { models: cached.models, source: "live" };
  try {
    const res = await elevenFetch(conn.apiKey, "/v1/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    const models = (Array.isArray(list) ? list : [])
      .filter((m) => m.can_do_text_to_speech)
      .map((m) => ({
        id: m.model_id,
        name: m.name,
        description: m.description || "",
        costMultiplier: Number(m.model_rates?.character_cost_multiplier ?? m.token_cost_factor ?? 1) || 1,
        maxChars: Number(m.maximum_text_length_per_request || m.max_characters_request_subscribed_user) || 5000,
        languages: (m.languages || []).length,
      }));
    if (!models.length) throw new Error("empty model list");
    modelsCache.set(conn.apiKey, { time: Date.now(), models });
    return { models, source: "live" };
  } catch {
    return { models: FALLBACK_MODELS, source: "fallback" };
  }
}

const voicesCache = new Map(); // apiKey -> { time, voices }
const VOICES_TTL = 10 * 60 * 1000;

export async function listElevenVoices(accountId = null, { force = false } = {}) {
  const conn = await resolveAccount(accountId);
  const cached = voicesCache.get(conn.apiKey);
  if (!force && cached && Date.now() - cached.time < VOICES_TTL) return cached.voices;
  const res = await elevenFetch(conn.apiKey, "/v1/voices");
  if (!res.ok) {
    const err = await readError(res);
    throw new ElevenRequestError(`Gagal memuat voices: ${err.message}`, 502, err.status);
  }
  const data = await res.json();
  const voices = (data.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category || "",
    gender: v.labels?.gender || "",
    accent: v.labels?.accent || "",
    language: v.labels?.language || "",
    // Languages ElevenLabs verified this voice speaks (premade voices list many, incl. "id").
    languages: [...new Set([v.labels?.language, ...(v.verified_languages || []).map((l) => l.language)].filter(Boolean))],
    description: v.labels?.descriptive || v.description || "",
    previewUrl: v.preview_url || null,
    source: "account",
  }));
  voicesCache.set(conn.apiKey, { time: Date.now(), voices });
  return voices;
}

const sharedCache = new Map(); // `${language}|${search}` -> { time, voices }
const SHARED_TTL = 30 * 60 * 1000;

/**
 * Community Voice Library (GET /v1/shared-voices). Free accounts may browse but
 * not synthesize with these over the API (402 paid_plan_required).
 */
export async function listElevenSharedVoices(accountId = null, { language = "id", search = "" } = {}) {
  const lang = String(language || "").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8);
  const q = String(search || "").trim().slice(0, 60);
  const cacheKey = `${lang}|${q}`;
  const cached = sharedCache.get(cacheKey);
  if (cached && Date.now() - cached.time < SHARED_TTL) return cached.voices;

  const conn = await resolveAccount(accountId);
  const params = new URLSearchParams({ page_size: "100", sort: "usage_character_count_1y" });
  if (lang) params.set("language", lang);
  if (q) params.set("search", q);
  const res = await elevenFetch(conn.apiKey, `/v1/shared-voices?${params}`);
  if (!res.ok) {
    const err = await readError(res);
    throw new ElevenRequestError(`Gagal memuat Voice Library: ${err.message}`, 502, err.status);
  }
  const data = await res.json();
  const voices = (data.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category || "",
    gender: v.gender || "",
    accent: v.accent || "",
    language: v.language || lang,
    locale: v.locale || "",
    languages: [v.language].filter(Boolean),
    description: v.descriptive || v.description || "",
    previewUrl: v.preview_url || null,
    publicOwnerId: v.public_owner_id || null,
    freeUsersAllowed: Boolean(v.free_users_allowed),
    usage1y: Number(v.usage_character_count_1y) || 0,
    source: "library",
  }));
  sharedCache.set(cacheKey, { time: Date.now(), voices });
  return voices;
}

/** Library voices must sit in "My Voices" before TTS can use them. */
async function ensureVoiceInAccount(conn, voiceId, publicOwnerId, voiceName) {
  const mine = await listElevenVoices(conn.id).catch(() => []);
  if (mine.some((v) => v.id === voiceId)) return;
  const res = await elevenFetch(conn.apiKey, `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: String(voiceName || voiceId).slice(0, 100) }),
  });
  if (!res.ok) {
    const err = await readError(res);
    throw new ElevenRequestError(`Gagal menambahkan voice ke akun '${conn.name}': ${err.message}`, res.status === 402 ? 402 : 400, err.status);
  }
  voicesCache.delete(conn.apiKey);
}

// ─── Accounts ────────────────────────────────────────────────────────────

export function maskKey(key) {
  const k = String(key || "");
  if (k.length <= 10) return k ? "••••" : "";
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

async function allConnections() {
  const list = await getProviderConnections({ provider: PROVIDER_ID });
  return list.filter((c) => c.authType === "apikey" && c.apiKey);
}

/** Explicit id → that row; otherwise the configured active row, else the first enabled one. */
async function resolveAccount(accountId = null) {
  if (accountId) {
    const conn = await getProviderConnectionById(accountId);
    if (!conn || conn.provider !== PROVIDER_ID || !conn.apiKey) {
      throw new ElevenRequestError(`Akun ElevenLabs '${accountId}' tidak ditemukan`, 404);
    }
    return conn;
  }
  const list = await allConnections();
  const cfg = await getElevenConfig();
  const active = list.find((c) => c.id === cfg.activeAccountId && c.isActive) || list.find((c) => c.isActive);
  if (!active) throw new ElevenRequestError("Belum ada akun ElevenLabs aktif. Tambahkan API key di tab Accounts.", 400, "no_account");
  return active;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function listElevenAccounts() {
  const [list, cfg] = await Promise.all([allConnections(), getElevenConfig()]);
  const since = startOfToday();
  const activeId = list.find((c) => c.id === cfg.activeAccountId && c.isActive)?.id || list.find((c) => c.isActive)?.id || "";
  const accounts = await Promise.all(
    list.map(async (c) => ({
      id: c.id,
      name: c.name || "ElevenLabs",
      keyPreview: maskKey(c.apiKey),
      enabled: c.isActive,
      priority: c.priority ?? null,
      isActive: c.id === activeId,
      creditCheck: c.providerSpecificData?.creditCheck || "ok",
      lastError: c.providerSpecificData?.elevenLastError || null,
      createdAt: c.createdAt,
      credits: await getLatestElevenCreditSnapshot(c.id),
      spentToday: await sumElevenCostSince(since, c.id),
    }))
  );
  return { accounts, activeAccountId: activeId, rotationStrategy: cfg.rotationStrategy, autoSwitchActive: cfg.autoSwitchActive };
}

async function setAccountMeta(conn, patch) {
  await updateProviderConnection(conn.id, {
    providerSpecificData: { ...(conn.providerSpecificData || {}), ...patch },
  });
}

/** Read the balance from ElevenLabs and store it. */
export async function refreshElevenCredits(accountId = null) {
  const conn = await resolveAccount(accountId);
  const sub = await fetchSubscription(conn.apiKey);
  if (!sub.ok) {
    const missingPerm = sub.code === "missing_permissions";
    await setAccountMeta(conn, { creditCheck: missingPerm ? "missing_user_read" : "error", elevenLastError: sub.message });
    throw new ElevenRequestError(
      missingPerm
        ? `API key '${conn.name}' tidak punya permission user_read, jadi saldo tidak bisa dibaca. Aktifkan "User → Read" di dashboard ElevenLabs.`
        : `Gagal membaca saldo '${conn.name}': ${sub.message}`,
      missingPerm ? 403 : 502,
      sub.code
    );
  }
  await setAccountMeta(conn, { creditCheck: "ok", elevenLastError: null });
  // ElevenLabs updates character_count minutes after a TTS call, so a fresh read
  // can be lower than what we already counted. Within one billing period usage
  // only grows: keep the higher number. A new nextResetUnix means a new period.
  const prev = await getLatestElevenCreditSnapshot(conn.id);
  const data = { ...sub.data };
  if (prev && prev.nextResetUnix === data.nextResetUnix && prev.characterCount > data.characterCount) {
    data.characterCount = prev.characterCount;
  }
  return insertElevenCreditSnapshot({ connectionId: conn.id, ...data });
}

/** Add a just-charged cost to the stored balance without waiting for ElevenLabs to catch up. */
async function recordElevenSpend(connectionId, cost) {
  const prev = await getLatestElevenCreditSnapshot(connectionId);
  if (!prev || !cost) return;
  await insertElevenCreditSnapshot({ ...prev, characterCount: prev.characterCount + cost });
}

export async function refreshAllElevenCredits() {
  const list = await allConnections();
  const results = [];
  for (const c of list) {
    try {
      results.push({ id: c.id, ok: true, snapshot: await refreshElevenCredits(c.id) });
    } catch (e) {
      results.push({ id: c.id, ok: false, error: e.message });
    }
  }
  return results;
}

export async function addElevenAccount({ name, apiKey, setActive = true }) {
  const key = String(apiKey || "").trim();
  const label = String(name || "").trim().slice(0, 60);
  if (!label) throw new ElevenRequestError("Nama akun wajib diisi");
  if (!/^[A-Za-z0-9_\-]{20,200}$/.test(key)) throw new ElevenRequestError("Format API key tidak valid");

  const existing = await allConnections();
  const dup = existing.find((c) => c.apiKey === key);
  if (dup) throw new ElevenRequestError(`API key ini sudah terdaftar sebagai '${dup.name}'`, 409);

  // Validate before storing. A key without user_read is still usable for TTS.
  const sub = await fetchSubscription(key);
  let creditCheck = "ok";
  if (!sub.ok) {
    if (sub.code === "missing_permissions") creditCheck = "missing_user_read";
    else throw new ElevenRequestError(`API key ditolak ElevenLabs: ${sub.message}`, 400, sub.code);
  }

  let conn;
  try {
    conn = await createProviderConnection({
      provider: PROVIDER_ID,
      authType: "apikey",
      name: label,
      apiKey: key,
      testStatus: "active",
      allowOverwrite: false,
      providerSpecificData: { creditCheck },
    });
  } catch (e) {
    if (e?.code === "PROVIDER_NAME_CONFLICT") throw new ElevenRequestError(`Nama '${label}' sudah dipakai`, 409);
    throw e;
  }
  if (sub.ok) await insertElevenCreditSnapshot({ connectionId: conn.id, ...sub.data });
  const cfg = await getElevenConfig();
  if (setActive || !cfg.activeAccountId) await saveElevenConfig({ activeAccountId: conn.id });
  return { id: conn.id, name: conn.name, creditCheck };
}

export async function setElevenAccountEnabled(accountId, enabled) {
  const conn = await resolveAccount(accountId);
  await updateProviderConnection(conn.id, { isActive: Boolean(enabled) });
}

export async function activateElevenAccount(accountId) {
  const conn = await resolveAccount(accountId);
  if (!conn.isActive) await updateProviderConnection(conn.id, { isActive: true });
  await saveElevenConfig({ activeAccountId: conn.id });
}

/** Move an account one place up or down in the fallback order. */
export async function moveElevenAccount(accountId, direction) {
  const list = await allConnections();
  const i = list.findIndex((c) => c.id === accountId);
  if (i === -1) throw new ElevenRequestError("Akun tidak ditemukan", 404);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return;
  const a = list[i];
  const b = list[j];
  const pa = a.priority ?? i + 1;
  const pb = b.priority ?? j + 1;
  await updateProviderConnection(a.id, { priority: pb });
  await updateProviderConnection(b.id, { priority: pa === pb ? pb + (direction === "up" ? 1 : -1) : pa });
}

export async function deleteElevenAccount(accountId) {
  const conn = await resolveAccount(accountId);
  await deleteProviderConnection(conn.id);
  await deleteElevenCreditSnapshots(conn.id);
  modelsCache.delete(conn.apiKey);
  voicesCache.delete(conn.apiKey);
  const cfg = await getElevenConfig();
  if (cfg.activeAccountId === conn.id) {
    const next = (await allConnections()).find((c) => c.isActive);
    await saveElevenConfig({ activeAccountId: next?.id || "" });
  }
}

// ─── Budget + generation ─────────────────────────────────────────────────

export async function elevenBudgetState() {
  const cfg = await getElevenConfig();
  const spentToday = await sumElevenCostSince(startOfToday());
  return {
    dailyCap: cfg.dailyBudgetCredits,
    spentToday,
    remainingToday: cfg.dailyBudgetCredits ? Math.max(0, cfg.dailyBudgetCredits - spentToday) : null,
  };
}

let roundRobinCursor = 0;

/** Ordered list of accounts to try for one request. */
async function candidateAccounts(explicitId, cfg) {
  if (explicitId) return [await resolveAccount(explicitId)];
  const enabled = (await allConnections()).filter((c) => c.isActive);
  if (!enabled.length) throw new ElevenRequestError("Belum ada akun ElevenLabs aktif. Tambahkan API key di tab Accounts.", 400, "no_account");
  const active = enabled.find((c) => c.id === cfg.activeAccountId) || enabled[0];
  if (cfg.rotationStrategy === "active_only") return [active];
  if (cfg.rotationStrategy === "round_robin") {
    const start = roundRobinCursor++ % enabled.length;
    return [...enabled.slice(start), ...enabled.slice(0, start)];
  }
  // Fallback: the active account, then the ones after it in list order, wrapping around.
  const idx = enabled.indexOf(active);
  return [...enabled.slice(idx), ...enabled.slice(0, idx)];
}

function isQuotaError(httpStatus, code) {
  return code === "quota_exceeded" || code === "insufficient_credits" || (httpStatus === 401 && /quota/i.test(String(code || "")));
}

/**
 * ElevenLabs said the account cannot pay for this request. Store what it told us
 * ("You have N credits remaining") so the next request skips it without a call.
 */
async function recordQuotaExceeded(conn, message) {
  const prev = await getLatestElevenCreditSnapshot(conn.id);
  const m = /have\s+(\d+)\s+credits?\s+remaining/i.exec(String(message || ""));
  const remaining = m ? Number(m[1]) : 0;
  const limitMatch = /quota of\s+(\d+)/i.exec(String(message || ""));
  const limit = prev?.characterLimit || (limitMatch ? Number(limitMatch[1]) : 0);
  if (!limit) return;
  await insertElevenCreditSnapshot({
    connectionId: conn.id,
    tier: prev?.tier || null,
    characterLimit: limit,
    characterCount: Math.max(0, limit - remaining),
    nextResetUnix: prev?.nextResetUnix ?? null,
  });
}

// Errors that are about this account, not the request: worth trying the next key.
function isAccountError(httpStatus, code) {
  if (httpStatus === 401 || httpStatus === 402) return true;
  if (httpStatus === 429) return true;
  return ["quota_exceeded", "invalid_api_key", "detected_unusual_activity", "too_many_concurrent_requests", "payment_required"].includes(code);
}

export async function generateElevenSpeech(input = {}) {
  const cfg = await getElevenConfig();
  const text = String(input.text || "").trim();
  if (!text) throw new ElevenRequestError("Teks wajib diisi");
  const model = String(input.model || cfg.defaultModel);
  const voiceId = String(input.voiceId || cfg.defaultVoiceId);
  if (!/^[A-Za-z0-9]{8,40}$/.test(voiceId)) throw new ElevenRequestError("voiceId tidak valid");
  const format = FORMAT_BY_VALUE.get(input.outputFormat || cfg.defaultOutputFormat) || FORMAT_BY_VALUE.get("mp3_44100_128");
  const vs = { ...cfg.voiceSettings, ...(input.voiceSettings || {}) };
  const voiceSettings = {
    stability: clamp(vs.stability, 0, 1, 0.5),
    similarity_boost: clamp(vs.similarity_boost, 0, 1, 0.75),
    style: clamp(vs.style, 0, 1, 0),
    use_speaker_boost: Boolean(vs.use_speaker_boost),
    speed: clamp(vs.speed, 0.7, 1.2, 1),
  };

  const { models } = await listElevenModels(input.accountId || null);
  const spec = models.find((m) => m.id === model);
  if (!spec) throw new ElevenRequestError(`Model '${model}' tidak tersedia untuk TTS`);
  if (text.length > spec.maxChars) {
    throw new ElevenRequestError(`Teks ${text.length} karakter, maksimal ${spec.maxChars} untuk ${spec.name}`);
  }
  const estimate = Math.ceil(text.length * spec.costMultiplier);

  const budget = await elevenBudgetState();
  if (budget.dailyCap && budget.spentToday + estimate > budget.dailyCap) {
    throw new ElevenRequestError(
      `Limit harian tercapai: terpakai ${budget.spentToday}/${budget.dailyCap} credits, request ini ±${estimate}. Naikkan limit di tab Config.`,
      429,
      "daily_budget"
    );
  }

  const candidates = await candidateAccounts(input.accountId || null, cfg);
  const attempts = [];
  let requestErrorStatus = null;
  let quotaSkips = 0;
  const payload = { text, model_id: model, voice_settings: voiceSettings };
  const languageCode = input.languageCode !== undefined ? String(input.languageCode || "") : cfg.defaultLanguageCode;
  if (languageCode) {
    if (!LANG_RE.test(languageCode)) throw new ElevenRequestError("Kode bahasa tidak valid (contoh: id, en)");
    payload.language_code = languageCode;
  }
  const libraryOwnerId = input.libraryOwnerId ? String(input.libraryOwnerId).replace(/[^A-Za-z0-9]/g, "").slice(0, 100) : "";
  if (input.seed !== undefined && input.seed !== "" && Number.isInteger(Number(input.seed))) payload.seed = Number(input.seed);

  for (const conn of candidates) {
    const snap = await getLatestElevenCreditSnapshot(conn.id);
    if (snap && snap.remaining - estimate < cfg.minRemainingCredits && candidates.length > 1) {
      attempts.push(`${conn.name}: sisa ${snap.remaining} credit, butuh ±${estimate}`);
      quotaSkips += 1;
      continue;
    }
    if (libraryOwnerId) {
      if (snap?.tier === "free") {
        attempts.push(`${conn.name}: akun free tidak bisa memakai voice dari Voice Library lewat API`);
        requestErrorStatus = 402;
        continue;
      }
      try {
        await ensureVoiceInAccount(conn, voiceId, libraryOwnerId, input.voiceName);
      } catch (e) {
        attempts.push(e.message);
        continue;
      }
    }
    const t0 = Date.now();
    let res;
    try {
      res = await elevenFetch(conn.apiKey, `/v1/text-to-speech/${voiceId}?output_format=${format.value}`, {
        config: cfg,
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: format.mime },
        body: JSON.stringify(payload),
        timeoutMs: 180000,
      });
    } catch (e) {
      attempts.push(`${conn.name}: ${e.message}`);
      continue;
    }
    if (!res.ok) {
      const err = await readError(res);
      if (err.status === "paid_plan_required") {
        attempts.push(`${conn.name}: voice ini butuh paket berbayar (akun free tidak bisa memakai voice Voice Library lewat API)`);
        requestErrorStatus = 402;
        continue;
      }
      attempts.push(`${conn.name}: ${err.message}`);
      if (isQuotaError(res.status, err.status)) {
        await recordQuotaExceeded(conn, err.message).catch(() => {});
        quotaSkips += 1;
      }
      if (isAccountError(res.status, err.status)) {
        await setAccountMeta(conn, { elevenLastError: err.message }).catch(() => {});
        continue;
      }
      // Request problem (bad voice, bad text): another key won't help, and it is not the account's fault.
      requestErrorStatus = res.status >= 400 && res.status < 500 ? 400 : 502;
      break;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 512) {
      attempts.push(`${conn.name}: audio kosong (${buf.byteLength} bytes)`);
      continue;
    }
    const id = uuidv4();
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const abs = path.join(AUDIO_DIR, `${id}.${format.ext}`);
    fs.writeFileSync(abs, buf);
    const cost = Number(res.headers.get("character-cost"));

    const job = await createElevenJob({
      id,
      connectionId: conn.id,
      accountName: conn.name,
      model,
      voiceId,
      voiceName: input.voiceName ? String(input.voiceName).slice(0, 120) : null,
      text,
      outputFormat: format.value,
      settings: voiceSettings,
      status: "completed",
      characterCost: Number.isFinite(cost) ? cost : estimate,
      mediaPath: abs,
      mime: format.mime,
      bytes: buf.byteLength,
      latencyMs: Number(res.headers.get("tts-latency-ms")) || Date.now() - t0,
      requestId: res.headers.get("request-id"),
      historyItemId: res.headers.get("history-item-id"),
    });
    await setAccountMeta(conn, { elevenLastError: null }).catch(() => {});
    await recordElevenSpend(conn.id, job.characterCost).catch(() => {});
    let switchedTo = null;
    const servedByOther = !input.accountId && cfg.rotationStrategy === "fallback" && conn.id !== candidates[0]?.id;
    if (servedByOther && cfg.autoSwitchActive && quotaSkips > 0) {
      await saveElevenConfig({ activeAccountId: conn.id });
      switchedTo = { id: conn.id, name: conn.name };
    }
    return { job, attempts, via: res.viaProxy || null, switchedTo };
  }

  const allOut = quotaSkips > 0 && quotaSkips === candidates.length;
  const message = allOut
    ? `Credit semua akun habis untuk request ini (±${estimate} credit). ${attempts.join(" · ")}`
    : attempts.length
      ? attempts.join(" · ")
      : "Tidak ada akun yang bisa dipakai";
  if (allOut) requestErrorStatus = 402;
  const failed = await createElevenJob({
    connectionId: candidates[0]?.id,
    accountName: candidates[0]?.name,
    model,
    voiceId,
    voiceName: input.voiceName || null,
    text,
    outputFormat: format.value,
    settings: voiceSettings,
    status: "failed",
    error: message.slice(0, 1000),
  });
  throw Object.assign(new ElevenRequestError(message, requestErrorStatus || 502), { job: failed });
}

// ─── Audio files ─────────────────────────────────────────────────────────

/** Absolute path of a job's audio, only if it is inside AUDIO_DIR. */
export async function resolveElevenAudio(jobId) {
  const row = await getElevenJobRow(jobId);
  if (!row?.mediaPath) return null;
  const abs = path.resolve(row.mediaPath);
  if (!abs.startsWith(path.resolve(AUDIO_DIR) + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return { abs, mime: row.mime || "audio/mpeg", row };
}

export async function deleteElevenJobWithAudio(jobId) {
  const audio = await resolveElevenAudio(jobId);
  if (audio) fs.rmSync(audio.abs, { force: true });
  await deleteElevenJob(jobId);
}

// ─── Export / import ─────────────────────────────────────────────────────

/** Plain API keys: only for the authenticated export route, never for list views. */
export async function exportElevenAccounts() {
  const list = await allConnections();
  return list.map((c) => ({ name: c.name || "ElevenLabs", apiKey: c.apiKey, enabled: c.isActive }));
}

/**
 * Accepts JSON (`[{name, apiKey}]` or `{accounts:[...]}`) or text lines
 * `name|apiKey`, `name,apiKey`, `name<TAB>apiKey` or a bare `apiKey`.
 */
export function parseElevenImport(input) {
  if (Array.isArray(input)) return input.map((a) => ({ name: a?.name, apiKey: a?.apiKey ?? a?.api_key ?? a?.key, enabled: a?.enabled }));
  const text = String(input || "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ElevenRequestError("File JSON tidak valid");
    }
    return parseElevenImport(Array.isArray(data) ? data : data?.accounts || []);
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const parts = line.split(/\s*[|,\t;]\s*/).filter(Boolean);
      if (parts.length === 1) return { name: "", apiKey: parts[0] };
      return { name: parts[0], apiKey: parts[parts.length - 1] };
    });
}

export async function importElevenAccounts(input) {
  const items = parseElevenImport(input).slice(0, 200);
  if (!items.length) throw new ElevenRequestError("Tidak ada akun yang bisa dibaca dari data import");
  const existing = await allConnections();
  const knownKeys = new Set(existing.map((c) => c.apiKey));
  const usedNames = new Set(existing.map((c) => c.name));
  const results = [];

  for (const [i, item] of items.entries()) {
    const apiKey = String(item.apiKey || "").trim();
    let name = String(item.name || "").trim().slice(0, 60) || `eleven_${maskKey(apiKey).slice(-4) || i + 1}`;
    if (!apiKey) {
      results.push({ name, status: "invalid", message: "API key kosong" });
      continue;
    }
    if (knownKeys.has(apiKey)) {
      results.push({ name, keyPreview: maskKey(apiKey), status: "skipped", message: "API key sudah terdaftar" });
      continue;
    }
    for (let n = 2; usedNames.has(name); n += 1) name = `${String(item.name || "eleven").slice(0, 55)}-${n}`;
    try {
      const res = await addElevenAccount({ name, apiKey, setActive: false });
      if (item.enabled === false) await updateProviderConnection(res.id, { isActive: false });
      knownKeys.add(apiKey);
      usedNames.add(res.name);
      results.push({
        name: res.name,
        keyPreview: maskKey(apiKey),
        status: "imported",
        message: res.creditCheck === "missing_user_read" ? "tersimpan, tanpa permission user_read" : "tersimpan",
      });
    } catch (e) {
      results.push({ name, keyPreview: maskKey(apiKey), status: "failed", message: String(e?.message || e).slice(0, 200) });
    }
  }
  return {
    imported: results.filter((r) => r.status === "imported").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed" || r.status === "invalid").length,
    results,
  };
}
