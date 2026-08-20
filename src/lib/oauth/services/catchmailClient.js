/**
 * Disposable mailbox client for catchmail.io.
 *
 * No API key required — pick a random address, then poll for messages and
 * pull the 6-digit OTP out of the message body (never the list headers,
 * which contain their own 6-digit runs and would cause false matches).
 */

const CATCHMAIL_API_BASE = "https://api.catchmail.io/api/v1";
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const FREE_DOMAINS = ["catchmail.io", "mailistry.com", "zeppost.com"];

const FIRST_NAMES = [
  "james", "mary", "john", "patricia", "robert", "jennifer", "michael", "linda",
  "william", "elizabeth", "david", "barbara", "richard", "susan", "joseph", "jessica",
  "thomas", "sarah", "charles", "karen", "christopher", "nancy", "daniel", "lisa",
];

const LAST_NAMES = [
  "smith", "johnson", "williams", "brown", "jones", "garcia", "miller", "davis",
  "rodriguez", "martinez", "hernandez", "lopez", "gonzalez", "wilson", "anderson",
  "thomas", "taylor", "moore", "jackson", "martin", "lee", "perez", "thompson", "white",
];

const OTP_PATTERN = /\b(\d{6})\b/;

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function generateEmail(domain = "random") {
  const resolvedDomain = domain === "random" ? randomItem(FREE_DOMAINS) : domain;
  const number = 10 + Math.floor(Math.random() * 9990);
  return `${randomItem(FIRST_NAMES)}${randomItem(LAST_NAMES)}${number}@${resolvedDomain}`;
}

export async function fetchMessages(email, { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${CATCHMAIL_API_BASE}/mailbox?address=${encodeURIComponent(email)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      for (const key of ["messages", "emails", "data", "results"]) {
        const value = data[key];
        if (Array.isArray(value)) return value;
      }
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function readMessage(messageId, email, { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${CATCHMAIL_API_BASE}/message/${encodeURIComponent(messageId)}?mailbox=${encodeURIComponent(email)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return {};
    const data = await response.json();
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

export function extractOtp(message) {
  const body = message?.body;
  if (!body || typeof body !== "object") return null;
  for (const key of ["text", "html"]) {
    const value = body[key];
    if (typeof value === "string") {
      const match = OTP_PATTERN.exec(value);
      if (match) return match[1];
    }
  }
  return null;
}

export async function waitForOtp(email, {
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (Date.now() < deadline) {
    const messages = await fetchMessages(email, { timeoutMs: fetchTimeoutMs });
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const messageId = message.id || message._id || message.message_id;
      if (!messageId) continue;
      const full = await readMessage(String(messageId), email, { timeoutMs: fetchTimeoutMs });
      const code = extractOtp(full);
      if (code) return code;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  const error = new Error(`No OTP received for ${email} within ${timeoutMs / 1000}s`);
  error.code = "CATCHMAIL_OTP_TIMEOUT";
  throw error;
}
