// server.js - freebuff2api self-hosted server  
// Exposes freebuff/codebuff free models as OpenAI/Anthropic-compatible APIs  
// with rotating proxy pools, session/model management and a live dashboard.  
  
import { createServer } from 'node:http';  
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';  
import { resolve, dirname, join, extname } from 'node:path';  
import { fileURLToPath } from 'node:url';  
import { fetch as nativeFetch } from 'undici';  
import { ProxyPool } from './proxy.js';  
import * as store from './store.js';  
import { registerBatch, parseAccountLines } from './register.js';  
  
const { default: handler, internals } = await import('./engine.js');  
const { scanQuota } = await import('./quota.js');  
const __dirname = dirname(fileURLToPath(import.meta.url));  
const ROOT = __dirname;  
const DB_PATH = resolve(ROOT, 'data.db');  
const CONFIG_PATH = resolve(ROOT, 'config.json');  
const CRED_DIR = resolve(ROOT, 'credentials');  
const PROXIES_FILE = resolve(ROOT, 'proxies.txt');  
const PUBLIC_DIR = resolve(ROOT, 'public');  
const DEFAULT_API_KEY = 'freebuff-default-key';  
const startedAt = Date.now();  
store.initStore(DB_PATH); 
function readTokenFiles() {  
  const out = [];  
  if (existsSync(CRED_DIR) === false) return out;  
  for (const f of readdirSync(CRED_DIR)) {  
    try {  
      const content = readFileSync(join(CRED_DIR, f), 'utf8');  
      for (const tok of content.split(/[\n,]/)) {  
        const t = tok.trim();  
        if (t.length > 8) out.push(t);  
      }  
    } catch {}  
  }  
  return out;  
}  
  
function readProxyFile() {  
  if (existsSync(PROXIES_FILE) === false) return [];  
  return readFileSync(PROXIES_FILE, 'utf8')  
    .split(/\r?\n/)  
    .map((s) => s.trim())  
    .filter((s) => s.length > 5 && s.charAt(0) !== '#');  
}  
  
function splitEnv(value) {  
  return (value || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);  
}  
  
function uniq(arr) {  
  return [...new Set(arr)];  
}  
  
function loadConfigFile() {  
  if (existsSync(CONFIG_PATH) === false) return {};  
  try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }  
} 
function migrateLegacy() {  
  if (store.listAccounts().length > 0 || store.getSetting('apiKey')) return;  
  const fileCfg = loadConfigFile();  
  const tokens = uniq([  
    ...(Array.isArray(fileCfg.tokens) ? fileCfg.tokens : []),  
    ...readTokenFiles(),  
    ...splitEnv(process.env.FREEBUFF_TOKEN),  
  ]).filter((t) => t.length > 8);  
  const proxies = uniq([  
    ...(Array.isArray(fileCfg.proxies) ? fileCfg.proxies : []),  
    ...readProxyFile(),  
    ...splitEnv(process.env.PROXIES || process.env.HTTP_PROXY || process.env.HTTPS_PROXY),  
  ]);  
  for (const t of tokens) {  
    const idx = t.indexOf(':');  
    store.addAccount(idx > 0 ? t.slice(0, idx).trim() : t, idx > 0 ? t.slice(idx + 1).trim() || null : null);  
  }  
  store.setSetting('apiKey', process.env.FREEBUFF_API_KEY || process.env.API_KEY || fileCfg.apiKey || DEFAULT_API_KEY);  
  store.setSetting('debug', String((process.env.FREEBUFF_DEBUG || fileCfg.debug || 'false') === 'true'));  
  store.setSetting('rotation', (process.env.ROTATION_MODE || fileCfg.rotation || 'pin') === 'roundrobin' ? 'roundrobin' : 'pin');  
  store.setSetting('sessionRotateEvery', String(Math.max(0, parseInt(process.env.SESSION_ROTATE_EVERY || fileCfg.sessionRotateEvery || '0', 10) || 0)));  
  store.setSetting('proxies', JSON.stringify(proxies));  
}  
migrateLegacy();  
  
let state = {  
  accounts: store.listAccounts(),  
  proxies: JSON.parse(store.getSetting('proxies', '[]') || '[]'),  
  apiKey: store.getSetting('apiKey', DEFAULT_API_KEY),  
  debug: store.getSetting('debug', 'false') === 'true',  
  rotation: store.getSetting('rotation', 'pin'),  
  sessionRotateEvery: parseInt(store.getSetting('sessionRotateEvery', '0'), 10) || 0,  
  proxyAutoRefresh: store.getSetting('proxyAutoRefresh', 'false') === 'true',  
};  
  
let quotaSnapshot = (() => {  
  try {  
    const raw = JSON.parse(store.getSetting('quotaSnapshot', 'null') || 'null');  
    if (raw && raw.data) return { data: raw.data, scannedAt: raw.scannedAt || 0 };  
  } catch {}  
  return null;  
})(); 
function persistQuotaSnapshot() {  
  store.setSetting('quotaSnapshot', JSON.stringify(quotaSnapshot || { data: null, scannedAt: 0 }));  
}  
  
function activeTokenList() {  
  return state.accounts.filter((a) => a.active).map((a) => (a.uid ? a.token + ':' + a.uid : a.token));  
}  
  
function isAccountBanned(a) {  
  if (a.state === 'banned') return true;  
  const h = internals.accountHealth()[a.token];  
  return h ? h.state === 'banned' : false;  
}  
  
function rotationTokenList() {  
  return state.accounts  
    .filter((a) => a.active && isAccountBanned(a) === false)  
    .map((a) => (a.uid ? a.token + ':' + a.uid : a.token));  
}  
  
function persistSettings() {  
  store.setSetting('apiKey', state.apiKey);  
  store.setSetting('debug', String(state.debug));  
  store.setSetting('rotation', state.rotation);  
  store.setSetting('sessionRotateEvery', String(state.sessionRotateEvery));  
  store.setSetting('proxyAutoRefresh', String(state.proxyAutoRefresh));  
  store.setSetting('proxies', JSON.stringify(state.proxies));  
}  
  
function reloadAccounts() {  
  const all = store.listAccounts();  
  let order = [];  
  try { order = JSON.parse(store.getSetting('accountOrder', '[]') || '[]'); } catch {}  
  if (Array.isArray(order) && order.length) {  
    const byToken = new Map(all.map((a) => [a.token, a]));  
    state.accounts = order.map((t) => byToken.get(t)).filter(Boolean);  
    for (const a of all) {  
      if (state.accounts.some((x) => x.token === a.token) === false) state.accounts.push(a);  
    }  
  } else {  
    state.accounts = all;  
  }  
}  
  
function persistAccountOrder() {  
  store.setSetting('accountOrder', JSON.stringify(state.accounts.map((a) => a.token)));  
}  
  
function slotToken(slot) {  
  const idx = Number.isInteger(slot) && slot >= 1 ? slot - 1 : -1;  
  const acct = state.accounts[idx];  
  return acct ? acct.token : null;  
} 
  
const env = {  
  get FREEBUFF_TOKEN() { return rotationTokenList().join(','); },  
  get API_KEY() { return state.apiKey; },  
  get FREEBUFF_API_KEY() { return state.apiKey; },  
  get FREEBUFF_DEBUG() { return String(state.debug); },  
  get ROTATION_MODE() { return state.rotation; },  
  get SESSION_ROTATE_EVERY() { return String(state.sessionRotateEvery); },  
  get FREEBUFF_ACCT_RPM() { return process.env.FREEBUFF_ACCT_RPM || '60'; },  
  get FREEBUFF_GLOBAL_RPM() { return process.env.FREEBUFF_GLOBAL_RPM || '300'; },  
  get FREEBUFF_AFFINITY_MAX_USES() { return process.env.FREEBUFF_AFFINITY_MAX_USES || '3'; },  
  get FREEBUFF_COOLDOWN_BASE_MS() { return process.env.FREEBUFF_COOLDOWN_BASE_MS || '30000'; },  
  get FREEBUFF_COOLDOWN_CAP_MS() { return process.env.FREEBUFF_COOLDOWN_CAP_MS || '1800000'; },  
};  
  
const pool = new ProxyPool(state.proxies);  
for (const a of state.accounts) {  
  if (a.proxy) pool.setBinding(a.token, a.proxy);  
}  
  
function isReplayableBody(body) {  
  return body == null || typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer || ArrayBuffer.isView(body);  
}  
  
function tokenFromInit(init) {  
  const h = init ? init.headers : null;  
  let auth = null;  
  if (h) {  
    if (typeof h.get === 'function') auth = h.get('Authorization') || h.get('authorization');  
    else if (typeof h === 'object') auth = h.Authorization || h.authorization;  
  }  
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);  
  return null;  
} 
  
const NO_DIRECT = String(process.env.FREEBUFF_NO_DIRECT || '').toLowerCase() === 'true';  
  
globalThis.fetch = function proxiedFetch(input, init = {}) {  
  const bound = pool.bindingDispatcher(tokenFromInit(init));  
  const entry = bound || pool.next();  
  if (!entry) {  
    if (NO_DIRECT) return Promise.reject(new Error('no proxy available (FREEBUFF_NO_DIRECT=1)'));  
    return nativeFetch(input, init);  
  }  
  const t0 = Date.now();  
  const attempt = (dispatcher) => nativeFetch(input, { ...init, dispatcher });  
  return attempt(entry.dispatcher).then(  
    (res) => { pool.reportSuccess(entry.key, Date.now() - t0); return res; },  
    (err) => {  
      pool.reportFailure(entry.key);  
      if (isReplayableBody(init.body) === false) throw err;  
      const next = pool.next();  
      if (next) {  
        const t1 = Date.now();  
        return attempt(next.dispatcher).then(  
          (res) => { pool.reportSuccess(next.key, Date.now() - t1); return res; },  
          (err2) => {  
            pool.reportFailure(next.key);  
            if (NO_DIRECT) throw err2;  
            return nativeFetch(input, init);  
          },  
        );  
      }  
      if (NO_DIRECT) throw err;  
      return nativeFetch(input, init);  
    },  
  );  
}; 
  
const MIME = {  
  '.html': 'text/html; charset=utf-8',  
  '.css': 'text/css; charset=utf-8',  
  '.js': 'text/javascript; charset=utf-8',  
  '.json': 'application/json; charset=utf-8',  
  '.svg': 'image/svg+xml',  
  '.png': 'image/png',  
  '.ico': 'image/x-icon',  
};  
  
function json(res, obj, status = 200) {  
  const body = JSON.stringify(obj);  
  res.writeHead(status, {  
    'Content-Type': 'application/json; charset=utf-8',  
    'Access-Control-Allow-Origin': '*',  
    'Cache-Control': 'no-store',  
  });  
  res.end(body);  
}  
  
function mask(token) {
  if (!token) return null;
  return token.length <= 10 ? token : token.slice(0, 6) + '...' + token.slice(-3);
}  
  
function getApiKey(request) {
  const expected = state.apiKey;
  const h = request.headers;
  const auth = h.authorization && h.authorization.startsWith('Bearer ') ? h.authorization : '';
  if (auth.startsWith('Bearer ')) return auth.slice(7) === expected ? expected : null;
  return h['x-api-key'] === expected ? expected : null;
}  
  
async function readJson(request) {
  try {
    const raw = await readBody(request);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
} 
  
async function handleStatus(res) {  
  const health = internals.accountHealth();  
  const accountStates = {};  
  let alive = 0;  
  let unhealthy = 0;  
  let unknown = 0;  
  let inactive = 0;  
  for (const a of state.accounts) {  
    const h = health[a.token];  
    if (a.active === false) { inactive++; continue; }  
    const s = a.state && a.state !== 'unknown' ? a.state : (h && h.state ? h.state : 'unknown');  
    accountStates[s] = (accountStates[s] || 0) + 1;  
    if (s === 'banned' || s === 'rate_limited') unhealthy++;  
    else if (h && h.alive === true) alive++;  
    else if (h && h.alive === false) unhealthy++;  
    else unknown++;  
  }  
  const proxies = pool.list();  
  const sessions = internals.sessions();  
  const models = internals.modelTableCached();  
  json(res, {  
    ...runSnapshot(),
    serviceRunState: runSnapshot().activeSessions > 0 ? 1 : 0,
    service: 'freebuff2api',  
    version: '2.0.0',  
    engine: internals.version,  
    uptime: Math.floor((Date.now() - startedAt) / 1000),  
    accounts: { total: state.accounts.length, active: state.accounts.length - inactive, inactive, alive, unhealthy, unknown, states: accountStates },  
    proxies: { total: proxies.length, ready: proxies.filter((p) => p.state === 'ready').length },  
    sessions: sessions.length,  
    models: models.length,  
    quota: quotaSnapshot ? { scannedAt: quotaSnapshot.scannedAt } : null,  
    cache: { sessions: sessions.length, accountsObserved: Object.keys(health).length },  
    time: new Date().toISOString(),  
  });  
} 
  
function handleAccounts(res) {  
  const health = internals.accountHealth();  
  const cooldowns = internals.cooldowns();  
  json(res, {  
    accounts: state.accounts.map((a, i) => {  
      const h = health[a.token];  
      const effState = a.state || (h ? h.state : null) || 'unknown';  
      return {  
        slot: i + 1,  
        token: mask(a.token),  
        uid: (h && h.uid) || a.uid ? mask((h && h.uid) || a.uid) : null,  
        active: a.active,  
        alive: h ? h.alive : null,  
        state: effState,  
        manualState: a.state || null,  
        checkedAt: h ? h.checkedAt : null,  
        cooldownUntil: cooldowns[a.token] || null,  
        hasQuota: Boolean(h && h.quota),  
        boundProxy: a.proxy || null,  
      };  
    }),  
  });  
}  
  
async function handleModels(res) {  
  const models = await internals.modelTable().catch(() => []);  
  json(res, {  
    object: 'list',  
    data: models.map((m) => ({  
      id: m.id,  
      object: 'model',  
      agent: m.agent,  
      upstream: m.upstream,  
      created: Math.floor(Date.now() / 1000),  
      owned_by: 'freebuff',  
    })),  
  });  
}  
  
function handleSessions(res) {  
  const sessions = internals.sessions();  
  const now = Date.now();  
  json(res, {  
    sessions: sessions.map((s) => {  
      const expMs = Date.parse(s.expiresAt || '');  
      const remainingMs = Number.isFinite(expMs) ? Math.max(0, expMs - now) : (s.remainingMs ?? 0);  
      const usable = Number.isFinite(expMs) ? expMs > now + 60000 : (typeof s.remainingMs === 'number' && s.remainingMs > 60000);  
      return {  
        key: s.key,  
        token: mask(s.token),  
        model: s.model,  
        instanceId: s.instanceId,  
        remainingMs,  
        expiresAt: s.expiresAt,  
        usable,  
      };  
    }),  
  });  
} 
  
async function handleCreateSession(res, body) {  
  const token = String(body.token || '').trim();  
  const model = String(body.model || '').trim();  
  if (!token || !model) return json(res, { ok: false, error: 'token and model required' }, 400);  
  try {  
    const session = await internals.createSession(token, model);  
    json(res, { ok: true, session: { model: session.model, instanceId: session.instanceId, remainingMs: session.remainingMs } });  
  } catch (e) {  
    json(res, { ok: false, error: e.message }, 502);  
  }  
}  
  
async function handleDeleteSession(res, body) {  
  const token = String(body.token || '').trim();  
  const model = String(body.model || '').trim();  
  if (!token || !model) return json(res, { ok: false, error: 'token and model required' }, 400);  
  const deleted = await internals.deleteSession(token, model);  
  json(res, { ok: true, deleted });  
}  
  
function runSnapshot() {  
  const sessions = internals.sessions();  
  const active = sessions.filter((s) => {  
    const expMs = Date.parse(s.expiresAt || '');  
    return Number.isFinite(expMs) ? expMs > Date.now() + 60000 : true;  
  }).length;  
  return { running: active > 0, activeSessions: active, totalSessions: sessions.length };  
}  
  
function handleRunStatus(res) {  
  json(res, { ok: true, ...runSnapshot() });  
}  
  
async function handleRunStart(res, body) {  
  const model = String(body.model || '').trim() || 'deepseek/deepseek-v4-flash';  
  const active = state.accounts.filter((a) => a.active);  
  if (active.length === 0) return json(res, { ok: false, error: 'no active accounts in pool' }, 400);  
  try {  
    const pick = active.find((a) => isAccountBanned(a) === false) || active[0];  
    const session = await internals.createSession(pick.token, model);  
    json(res, {  
      ok: true,  
      running: true,  
      account: mask(pick.token),  
      model: session.model,  
      instanceId: session.instanceId,  
      remainingMs: session.remainingMs,  
    });  
  } catch (e) {  
    json(res, { ok: false, error: e.message }, 502);  
  }  
}  
  
function handleRunStop(res) {  
  const sessions = internals.sessions();  
  const count = sessions.length;  
  for (const s of sessions) {  
    const token = s.key.split(':')[0];  
    internals.deleteSession(token, s.model);  
  }  
  json(res, { ok: true, stopped: count, running: false, ...runSnapshot() });  
}  
  
function handleRun(res, body) {  
  const action = String(body.action || '').trim() || 'status';  
  if (action === 'start') return handleRunStart(res, body);  
  if (action === 'stop') return handleRunStop(res);  
  return handleRunStatus(res);  
} 
  
async function handleQuota(res, forceRefresh = false) {  
  if (forceRefresh || quotaSnapshot === null || Date.now() - quotaSnapshot.scannedAt > 5 * 60 * 1000) {  
    try {  
      const accounts = state.accounts.filter((a) => a.active);  
      const data = await scanQuota(accounts, 3);  
      quotaSnapshot = { data, scannedAt: Date.now() };  
      persistQuotaSnapshot();  
    } catch (e) {  
      if (quotaSnapshot === null) {  
        json(res, { scanning: true, error: e.message }, 502);  
        return;  
      }  
    }  
  }  
  json(res, { ...quotaSnapshot.data, scannedAt: quotaSnapshot.scannedAt });  
}  
  
let registerJob = null;  
let registerStop = false;  
  
function handleRegisterStatus(res) {  
  if (registerJob === null) return json(res, { ok: true, running: false, total: 0, done: 0, okCount: 0, failed: 0, accounts: [] });  
  json(res, {  
    ok: true,  
    running: registerJob.running,  
    total: registerJob.total,  
    done: registerJob.done,  
    okCount: registerJob.okCount,  
    failed: registerJob.failed,  
    accounts: registerJob.accounts,  
  });  
}  
  
function handleRegisterCancel(res) {  
  registerStop = true;  
  json(res, { ok: true, stopping: true });  
}  
  
async function handleRegister(res, body) {  
  if (registerJob && registerJob.running) return json(res, { ok: false, error: 'register job already running' }, 409);  
  const batch = String(body.batch || '').trim();  
  const accounts = batch ? parseAccountLines(batch) : (Array.isArray(body.accounts) ? body.accounts : []);  
  if (accounts.length === 0) return json(res, { ok: false, error: 'no accounts provided' }, 400);  
  registerStop = false;  
  registerJob = {  
    running: true,  
    total: accounts.length,  
    done: 0,  
    okCount: 0,  
    failed: 0,  
    accounts: [],  
  };  
  const log = (msg) => {};  
  registerBatch(accounts, {  
    proxy: String(body.proxy || '').trim() || undefined,  
    useProxyPool: body.useProxyPool !== false,  
    log,  
    onStart: (acc, i) => {  
      registerJob.accounts[i] = { email: acc.email, status: 'running' };  
    },  
    onResult: (rec) => {  
      registerJob.done++;  
      const idx = registerJob.accounts.findIndex((a) => a && a.email === rec.email);  
      if (rec.ok) {  
        registerJob.okCount++;  
        if (rec.token) store.addAccount(rec.token, rec.uid || null);  
        reloadAccounts();  
      } else {  
        registerJob.failed++;  
      }  
      if (idx >= 0) registerJob.accounts[idx] = { email: rec.email, status: rec.ok ? 'ok' : 'failed', error: rec.error || null };  
    },  
    shouldStop: () => registerStop,  
  }).then(() => { registerJob.running = false; }).catch((e) => { registerJob.running = false; registerJob.failed++; });  
  json(res, { ok: true, running: true, total: accounts.length });  
} 
  
function handleConfigGet(res) {  
  json(res, {  
    tokens: state.accounts.map((a) => (a.uid ? a.token + ':' + a.uid : a.token)),  
    proxies: state.proxies,  
    apiKey: state.apiKey,  
    debug: state.debug,  
    rotation: state.rotation,  
    sessionRotateEvery: state.sessionRotateEvery,  
    proxyAutoRefresh: state.proxyAutoRefresh,  
  });  
}  
  
function handleConfigPost(res, body) {  
  if (Array.isArray(body.tokens)) {  
    for (const t of body.tokens) {  
      const idx = String(t).indexOf(':');  
      store.addAccount(idx > 0 ? String(t).slice(0, idx).trim() : String(t).trim(), idx > 0 ? String(t).slice(idx + 1).trim() || null : null);  
    }  
    reloadAccounts();  
  }  
  if (Array.isArray(body.proxies)) {  
    state.proxies = body.proxies.map(String).filter((p) => p.trim().length > 5);  
    pool.clear();  
    for (const p of state.proxies) pool.add(p);  
  }  
  if (body.debug !== undefined) state.debug = !!body.debug;  
  if (body.rotation !== undefined) state.rotation = body.rotation === 'roundrobin' ? 'roundrobin' : 'pin';  
  if (body.sessionRotateEvery !== undefined) state.sessionRotateEvery = Math.max(0, parseInt(body.sessionRotateEvery, 10) || 0);  
  if (body.proxyAutoRefresh !== undefined) state.proxyAutoRefresh = !!body.proxyAutoRefresh;  
  persistSettings();  
  json(res, { ok: true });  
}  
  
function handleProxyAdd(res, body) {  
  const url = String(body.url || '').trim();  
  if (!url) return json(res, { ok: false, error: 'url required' }, 400);  
  const added = pool.add(url);  
  if (added === false) return json(res, { ok: false, error: 'invalid or duplicate proxy' }, 400);  
  state.proxies = pool.order;  
  persistSettings();  
  json(res, { ok: true });  
}  
  
function handleProxyRemove(res, body) {  
  const url = String(body.url || '').trim();  
  const removed = pool.remove(url);  
  state.proxies = pool.order;  
  persistSettings();  
  json(res, { ok: true, removed });  
}  
  
async function handleProxyTest(res, body) {  
  const url = String(body.url || '').trim();  
  if (!url) return json(res, { ok: false, error: 'url required' }, 400);  
  try {  
    const t0 = Date.now();  
    const resp = await nativeFetch('https://www.codebuff.com/api/v1/me', {  
      dispatcher: new (await import('undici')).Agent({ connect: makeProxyConnector(url) }),  
      signal: AbortSignal.timeout(15000),  
    });  
    json(res, { ok: resp.ok, latencyMs: Date.now() - t0, status: resp.status });  
  } catch (e) {  
    json(res, { ok: false, error: e.message });  
  }  
} 
  
function handleProxyList(res) {  
  json(res, { proxies: pool.list() });  
}  
  
function handleProxyRotate(res) {  
  pool.rotate();  
  json(res, { ok: true, idx: pool.idx });  
}  
  
function handleAccountAdd(res, body) {  
  const token = String(body.token || '').trim();  
  if (!token || token.length <= 8) return json(res, { ok: false, error: 'token required (length > 8)' }, 400);  
  const idx = token.indexOf(':');  
  store.addAccount(idx > 0 ? token.slice(0, idx).trim() : token, idx > 0 ? token.slice(idx + 1).trim() || null : null);  
  reloadAccounts();  
  persistAccountOrder();  
  json(res, { ok: true });  
}  
  
function handleAccountRemove(res, body) {  
  const slot = Number(body.slot);  
  const token = slotToken(slot);  
  if (!token) return json(res, { ok: false, error: 'invalid slot' }, 400);  
  store.removeAccount(token);  
  reloadAccounts();  
  persistAccountOrder();  
  json(res, { ok: true });  
}  
  
function handleAccountActive(res, body) {  
  const slot = Number(body.slot);  
  const token = slotToken(slot);  
  if (!token) return json(res, { ok: false, error: 'invalid slot' }, 400);  
  store.setAccountActive(token, !!body.active);  
  reloadAccounts();  
  json(res, { ok: true });  
}  
  
function handleAccountState(res, body) {  
  const slot = Number(body.slot);  
  const token = slotToken(slot);  
  if (!token) return json(res, { ok: false, error: 'invalid slot' }, 400);  
  store.setAccountState(token, String(body.state || '').trim() || null);  
  reloadAccounts();  
  json(res, { ok: true });  
}  
  
function handleAccountProxy(res, body) {  
  const slot = Number(body.slot);  
  const token = slotToken(slot);  
  if (!token) return json(res, { ok: false, error: 'invalid slot' }, 400);  
  const proxy = String(body.proxy || '').trim() || null;  
  store.setAccountProxy(token, proxy);  
  if (proxy) pool.setBinding(token, proxy);  
  else pool.clearBinding(token);  
  reloadAccounts();  
  json(res, { ok: true });  
} 
  
function handleAccountRotate(res) {  
  if (state.accounts.length > 1) {  
    const first = state.accounts.shift();  
    state.accounts.push(first);  
}  
  persistAccountOrder();  
  json(res, { ok: true });  
}  
  
async function handleAccountAutoProxy(res) {  
  const proxies = pool.order;  
  if (proxies.length === 0) return json(res, { ok: false, error: 'no proxies in pool' }, 400);  
  for (const a of state.accounts) {  
    const p = proxies[Math.floor(Math.random() * proxies.length)];  
    store.setAccountProxy(a.token, p);  
    pool.setBinding(a.token, p);  
  }  
  reloadAccounts();  
  json(res, { ok: true });  
}  
  
function handleAccountDeleteBanned(res) {  
  let removed = 0;  
  for (const a of [...state.accounts]) {  
    if (a.state === 'banned' || isAccountBanned(a)) {  
      store.removeAccount(a.token);  
      removed++;  
    }  
  }  
  reloadAccounts();  
  json(res, { ok: true, removed });  
}  
  
async function handleAuthCode(res) {  
  try {  
    const device = await internals.startDeviceAuth();  
    json(res, { ok: true, ...device });  
  } catch (e) {  
    json(res, { ok: false, error: e.message }, 502);  
  }  
}  
  
async function handleAuthStatus(res, url) {  
  const q = new URL(url);  
  const fpId = q.searchParams.get('fingerprintId');  
  const fpHash = q.searchParams.get('fingerprintHash');  
  const exp = q.searchParams.get('expiresAt');  
  try {  
    const st = await internals.pollDeviceAuth(fpId, fpHash, Number(exp || 0));  
    if (st.status === 'ready') {  
      store.addAccount(st.authToken, st.uid || null);  
      reloadAccounts();  
      json(res, { ok: true, status: 'ready', email: st.email || null });  
    } else {  
      json(res, { ok: true, status: 'pending' });  
    }  
  } catch (e) {  
    json(res, { ok: false, error: e.message }, 502);  
  }  
} 
  
function serveStatic(res, pathname) {  
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/\/+/, '');  
  if (rel.includes('..') || rel.includes(':')) {  
    res.writeHead(403); res.end('Forbidden'); return;  
  }  
  const filePath = join(PUBLIC_DIR, rel);  
  if (existsSync(filePath) === false || statSync(filePath).isDirectory()) {  
    res.writeHead(404); res.end('Not found'); return;  
  }  
  const ext = extname(filePath);  
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });  
  res.end(readFileSync(filePath));  
}  
  
async function readBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const b = Buffer.concat(chunks).toString("utf8");
  return b ? b : undefined;
}
// ---------------------------------------------------------------- router ----  
async function route(req, res) {  
  const url = new URL(req.url, 'http://localhost');  
  const pathname = url.pathname;  
  const method = req.method;  
  const isApi = pathname.startsWith('/api/') || pathname === '/api';  
  
  // healthz: unauthenticated  
  if (method === 'GET' && pathname === '/healthz') {  
    json(res, { status: 'ok', version: '2.0.0', time: new Date().toISOString() });  
    return;  
  }  
  
  // CORS preflight  
  if (method === 'OPTIONS') {  
    res.writeHead(204, {  
      'Access-Control-Allow-Origin': '*',  
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',  
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',  
    });  
    res.end();  
    return;  
  }  
  
  // API key check for /api (except healthz)  
  if (isApi && getApiKey(req) === null) {  
    json(res, { error: 'Invalid API key', type: 'auth_error' }, 401);  
    return;  
  }  
  
  if (isApi) {  
    const body = (method === 'POST' || method === 'DELETE') ? await readJson(req) : {};  
    if (method === 'GET' && pathname === '/api/status') return handleStatus(res);  
    if (method === 'GET' && pathname === '/api/accounts') return handleAccounts(res);  
    if (method === 'GET' && pathname === '/api/models') return handleModels(res);  
    if (method === 'GET' && pathname === '/api/sessions') return handleSessions(res);  
    if (method === 'DELETE' && pathname === '/api/sessions') {  
      const s = internals.sessions();  
      for (const x of s) internals.deleteSession(x.token, x.model);  
      return json(res, { ok: true });  
    }  
    if (method === 'POST' && pathname === '/api/session') return handleCreateSession(res, body);  
    if (method === 'DELETE' && pathname === '/api/session') return handleDeleteSession(res, body);  
    if (method === 'GET' && pathname === '/api/quota') return handleQuota(res, false);  
    if (method === 'POST' && pathname === '/api/quota/refresh') return handleQuota(res, true);  
    if (method === 'GET' && pathname === '/api/proxies') return handleProxyList(res);  
    if (method === 'POST' && pathname === '/api/proxy') return handleProxyAdd(res, body);  
    if (method === 'DELETE' && pathname === '/api/proxy') return handleProxyRemove(res, body);  
    if (method === 'POST' && pathname === '/api/proxy/test') return handleProxyTest(res, body);  
    if (method === 'POST' && pathname === '/api/proxy/rotate') return handleProxyRotate(res);  
    if (method === 'POST' && pathname === '/api/account') return handleAccountAdd(res, body);  
    if (method === 'DELETE' && pathname === '/api/account') return handleAccountRemove(res, body);  
    if (method === 'POST' && pathname === '/api/account/active') return handleAccountActive(res, body);  
    if (method === 'POST' && pathname === '/api/account/state') return handleAccountState(res, body);  
    if (method === 'POST' && pathname === '/api/account/proxy') return handleAccountProxy(res, body);  
    if (method === 'POST' && pathname === '/api/account/rotate') return handleAccountRotate(res);  
    if (method === 'POST' && pathname === '/api/account/auto-proxy') return handleAccountAutoProxy(res);  
    if (method === 'POST' && pathname === '/api/account/delete-banned') return handleAccountDeleteBanned(res);  
    if (method === 'POST' && pathname === '/api/auth/cli/code') return handleAuthCode(res);  
    if (method === 'GET' && pathname === '/api/auth/cli/status') return handleAuthStatus(res, req.url);  
    if (method === 'GET' && pathname === '/api/config') return handleConfigGet(res);  
    if (method === 'POST' && pathname === '/api/config') return handleConfigPost(res, body);  
    if (method === 'POST' && pathname === '/api/register') return handleRegister(res, body);  
    if (method === 'GET' && pathname === '/api/register/status') return handleRegisterStatus(res);  
    if (method === 'POST' && pathname === '/api/register/cancel') return handleRegisterCancel(res);  
    if (method === 'POST' && pathname === '/api/run') return handleRun(res, body);  
    return json(res, { error: 'Not found', type: 'not_found' }, 404);  
  }  
  
  // Engine (OpenAI/Anthropic) routes or static  
  const isEngine = pathname.startsWith('/v1/') || pathname === '/v1';  
  if (isEngine) {  
    try {  
      const reqBody = method === 'POST' ? await readBody(req) : undefined;
const h = {};
for (const k of Object.keys(req.headers)) h[k] = req.headers[k];
const request = new Request('http://localhost' + req.url, { method, headers: h, body: reqBody });
const response = await handler.fetch(request, env);  
      res.writeHead(response.status, Object.fromEntries(response.headers));  
      const buf = await response.arrayBuffer();  
      res.end(Buffer.from(buf));  
    } catch (e) {  
      json(res, { error: { message: e.message, type: 'api_error' } }, 502);  
    }  
    return;  
  }  
  
  serveStatic(res, pathname);  
}  
  
const server = createServer(route);  
const HOST = process.env.HOST || '0.0.0.0';  
const PORT = parseInt(process.env.PORT || '8787', 10);  
server.listen(PORT, HOST, () => {  
  console.log('[freebuff2api] listening on http://' + HOST + ':' + PORT);  
}); 
