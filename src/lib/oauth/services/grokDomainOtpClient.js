const DEFAULT_BASE_URL = "https://otp.cloudverra.com";
const DEFAULT_INTERVAL_MS = 3_000;

function assertOtpBaseUrl(value) {
  const url = new URL(value || DEFAULT_BASE_URL);
  if (url.protocol !== "https:") throw new Error("Grok domain OTP endpoint must use HTTPS");
  if (url.hostname !== "otp.cloudverra.com") {
    throw new Error("Grok domain OTP endpoint host is not allowed");
  }
  return url.origin;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("OTP polling cancelled"));
    }, { once: true });
  });
}

function withTimeout(signal, timeoutMs = 15_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function readJsonLimited(response) {
  const text = (await response.text()).slice(0, 16_384);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseUpdatedAt(payload) {
  const candidates = [payload?.updated, payload?.createdAt, payload?.timestamp];
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export class GrokDomainOtpClient {
  constructor({
    baseUrl = process.env.GROK_DOMAIN_OTP_BASE_URL || DEFAULT_BASE_URL,
    fetchImpl = fetch,
    waitImpl = wait,
  } = {}) {
    this.baseUrl = assertOtpBaseUrl(baseUrl);
    this.fetch = fetchImpl;
    this.wait = waitImpl;
  }

  async getLatestCode(email, signal) {
    const url = new URL(`${this.baseUrl}/code`);
    url.searchParams.set("email", email);
    const response = await this.fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: withTimeout(signal),
    });
    if (response.status === 204 || response.status === 404) return null;
    if (response.status === 429) {
      return { retryAfterMs: Math.min(30_000, Math.max(3_000, Number(response.headers.get("retry-after")) * 1000 || 3_000)) };
    }
    if (response.status >= 500) return null;
    if (!response.ok) throw new Error(`OTP code endpoint failed (${response.status})`);
    const payload = await readJsonLimited(response);
    const code = String(payload?.code || "").trim();
    return code ? { code, updatedAt: parseUpdatedAt(payload) } : null;
  }

  async waitForCode(email, {
    baselineCode = null,
    intervalMs = DEFAULT_INTERVAL_MS,
    signal,
    onPoll,
  } = {}) {
    // Intentionally no deadline: xAI may rate-limit code delivery for several minutes.
    // The user cancelling the job/browser is the only stop condition.
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error("OTP polling cancelled");
      let result = null;
      try {
        result = await this.getLatestCode(email, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!/fetch|network|timeout|aborted/i.test(error.message || "")) throw error;
      }
      if (result?.code) {
        // The OTP service timestamp has no timezone and may differ from the router host.
        // Email-specific polling + baseline comparison is the reliable freshness signal.
        const freshByCode = !baselineCode || result.code !== baselineCode;
        if (freshByCode) return result.code;
      }
      onPoll?.();
      await this.wait(result?.retryAfterMs || intervalMs, signal);
    }
  }

  async confirm(email, code, signal) {
    const response = await this.fetch(`${this.baseUrl}/confirm`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
      redirect: "error",
      signal: withTimeout(signal),
    });
    const payload = await readJsonLimited(response);
    if (!response.ok) throw new Error(`OTP confirm endpoint failed (${response.status})`);
    if (payload?.ok === false || payload?.success === false) {
      throw new Error(payload?.error || "OTP confirm endpoint rejected the code");
    }
    return payload;
  }
}

export const __test__ = { assertOtpBaseUrl, parseUpdatedAt, withTimeout };
