import crypto from "node:crypto";

const XAI_AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_REDIRECT_URI = "http://127.0.0.1:56121/callback";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(96));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function callbackCode(url, expectedState) {
  try {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return null;
    if (!parsed.pathname.includes("/callback")) return null;
    if (expectedState && parsed.searchParams.get("state") !== expectedState) return null;
    return parsed.searchParams.get("code");
  } catch {
    return null;
  }
}

export async function obtainGrokCliPkceTokens({
  page,
  proxyDispatcher,
  reportStep = () => {},
  handleAuthorizationPage,
  fetchImpl = fetch,
}) {
  const { verifier, challenge } = createPkce();
  const state = base64Url(crypto.randomBytes(24));
  const nonce = crypto.randomBytes(16).toString("hex");
  const authorizeUrl = new URL(XAI_AUTHORIZE_URL);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: XAI_CLIENT_ID,
    redirect_uri: XAI_REDIRECT_URI,
    scope: XAI_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "cli-proxy-api",
  })) authorizeUrl.searchParams.set(key, value);

  let authorizationCode = null;
  const captureCallback = async (route) => {
    const code = callbackCode(route.request().url(), state);
    if (!code) return route.continue();
    authorizationCode = code;
    await route.abort().catch(() => null);
  };
  await page.route("**/*", captureCallback);
  try {
    reportStep("starting_pkce_authorization", "Starting Grok CLI PKCE authorization");
    await page.goto(authorizeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null);
    const deadline = Date.now() + 120_000;
    while (!authorizationCode && Date.now() < deadline) {
      authorizationCode = callbackCode(page.url(), state) || authorizationCode;
      if (authorizationCode) break;
      await handleAuthorizationPage?.(page);
      await page.waitForTimeout(750);
    }
  } finally {
    await page.unroute("**/*", captureCallback).catch(() => null);
  }
  if (!authorizationCode) throw new Error("Grok CLI PKCE callback code was not captured");

  reportStep("exchanging_pkce_token", "Exchanging Grok CLI PKCE code for tokens");
  const requestInit = {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XAI_CLIENT_ID,
      code: authorizationCode,
      redirect_uri: XAI_REDIRECT_URI,
      code_verifier: verifier,
    }),
  };
  if (proxyDispatcher) requestInit.dispatcher = proxyDispatcher;
  const response = await fetchImpl(XAI_TOKEN_URL, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Grok CLI PKCE token exchange failed (${response.status}): ${payload.error_description || payload.error || "missing access token"}`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    idToken: payload.id_token || null,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    id_token: payload.id_token,
    expires_in: payload.expires_in,
  };
}

export const __test__ = { callbackCode, createPkce };
