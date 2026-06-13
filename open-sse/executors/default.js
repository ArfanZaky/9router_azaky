import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../../src/shared/utils/clineAuth.js";
import { getCachedClaudeHeaders } from "../utils/claudeHeaderCache.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { randomUUID } from "crypto";
import { gzipSync } from "zlib";

const CODEBUDDY_SYSTEM_PROMPT = "You are CodeBuddy Code.";
const CODEBUDDY_MIN_OUTPUT_TOKENS = 16;
const CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS = 1200;
const CODEBUDDY_SCHEMA_DESCRIPTION_MAX_CHARS = 500;
const CODEBUDDY_ALLOWED_REQUEST_FIELDS = [
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "stop",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
];

function codeBuddyRequestId() {
  return randomUUID().replace(/-/g, "");
}

function truncateMiddle(text, maxChars, label = "truncated for CodeBuddy") {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.75);
  const tail = Math.max(0, maxChars - head - label.length - 12);
  return `${text.slice(0, head)}\n\n[${label}]\n\n${text.slice(-tail)}`;
}

function sanitizeCodeBuddyContent(content, role) {
  if (role === "system" || role === "developer") return "";
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (!part || typeof part !== "object") return part;
    return part;
  });
}

function sanitizeCodeBuddySchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeCodeBuddySchema);
  const next = { ...schema };
  if (typeof next.description === "string") {
    next.description = truncateMiddle(
      next.description,
      CODEBUDDY_SCHEMA_DESCRIPTION_MAX_CHARS,
      "schema description truncated"
    );
  }
  for (const key of Object.keys(next)) {
    if (key !== "description" && next[key] && typeof next[key] === "object") {
      next[key] = sanitizeCodeBuddySchema(next[key]);
    }
  }
  return next;
}

function normalizeCodeBuddyTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    if (tool.function && typeof tool.function === "object") {
      return {
        ...tool,
        function: {
          ...tool.function,
          description: truncateMiddle(
            tool.function.description || "",
            CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS,
            "tool description truncated"
          ),
          parameters: sanitizeCodeBuddySchema(tool.function.parameters),
        },
      };
    }
    return {
      ...tool,
      description: truncateMiddle(
        tool.description || "",
        CODEBUDDY_TOOL_DESCRIPTION_MAX_CHARS,
        "tool description truncated"
      ),
      input_schema: sanitizeCodeBuddySchema(tool.input_schema),
      parameters: sanitizeCodeBuddySchema(tool.parameters),
    };
  });
}

function normalizeCodeBuddyMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const next = [{ role: "system", content: CODEBUDDY_SYSTEM_PROMPT }];
  for (const message of source) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system" || message.role === "developer") continue;
    const sanitized = {
      ...message,
      content: sanitizeCodeBuddyContent(message.content, message.role),
    };
    if (sanitized.role === "user" && typeof sanitized.content === "string") {
      next.push({ ...sanitized, content: [{ type: "text", text: sanitized.content }] });
    } else {
      next.push(sanitized);
    }
  }
  return next;
}

function buildCodeBuddyBody(model, transformed, maxTokens, maxCompletionTokens) {
  const body = {
    model,
    messages: normalizeCodeBuddyMessages(transformed.messages),
    stream: true,
  };
  for (const field of CODEBUDDY_ALLOWED_REQUEST_FIELDS) {
    if (transformed[field] !== undefined) body[field] = transformed[field];
  }
  if (Array.isArray(transformed.tools)) body.tools = normalizeCodeBuddyTools(transformed.tools);
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    body.max_tokens = Math.max(maxTokens, CODEBUDDY_MIN_OUTPUT_TOKENS);
  } else if (Number.isFinite(maxCompletionTokens) && maxCompletionTokens > 0) {
    body.max_tokens = Math.max(maxCompletionTokens, CODEBUDDY_MIN_OUTPUT_TOKENS);
  }
  return body;
}

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model, body) {
    const transformed = this.applyJsonSchemaFallback(body);
    if (this.provider === "codebuddy") {
      const maxTokens = Number(transformed.max_tokens);
      const maxCompletionTokens = Number(transformed.max_completion_tokens);
      return buildCodeBuddyBody(model, transformed, maxTokens, maxCompletionTokens);
    }
    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  prepareRequestBody(transformedBody, headers) {
    const bodyStr = JSON.stringify(transformedBody);
    if (this.provider !== "codebuddy") return bodyStr;
    headers["Content-Encoding"] = "gzip";
    return gzipSync(bodyStr);
  }

  // Fallback json_schema → json_object for openai-compatible providers without native Structured Output.
  applyJsonSchemaFallback(body) {
    if (!this.provider?.startsWith?.("openai-compatible-")) return body;
    const rf = body?.response_format;
    if (rf?.type !== "json_schema" || !rf.json_schema?.schema) return body;

    const schemaJson = JSON.stringify(rf.json_schema.schema, null, 2);
    const prompt = `You must respond with valid JSON that strictly follows this JSON schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\nRespond ONLY with the JSON object, no other text.`;

    const messages = Array.isArray(body.messages) ? body.messages.map(m => ({ ...m })) : [];
    const sys = messages.find(m => m.role === "system");
    if (sys) {
      if (typeof sys.content === "string") sys.content = `${sys.content}\n\n${prompt}`;
      else if (Array.isArray(sys.content)) sys.content.push({ type: "text", text: `\n\n${prompt}` });
    } else {
      messages.unshift({ role: "system", content: prompt });
    }
    return { ...body, messages, response_format: { type: "json_object" } };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    switch (this.provider) {
      case "claude":
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
        return `${this.config.baseUrl}?beta=true`;
      case "kimi-coding":
        return `${this.config.baseUrl}?beta=true`;
      case "gemini":
        return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      default: {
        const url = this.config.baseUrl;
        if (url?.includes("{accountId}")) {
          const accountId = credentials?.providerSpecificData?.accountId;
          if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
          return url.replace("{accountId}", accountId);
        }
        return url;
      }
    }
  }

  buildHeaders(credentials, stream = true) {
    const headers = { "Content-Type": "application/json", ...this.config.headers };

    switch (this.provider) {
      case "gemini":
        credentials.apiKey ? headers["x-goog-api-key"] = credentials.apiKey : headers["Authorization"] = `Bearer ${credentials.accessToken}`;
        break;
      case "claude": {
        // Overlay live cached headers from real Claude Code client over static defaults.
        // Static headers (Title-Case) remain as cold-start fallback.
        const cached = getCachedClaudeHeaders();
        if (cached) {
          // Remove Title-Case static keys that conflict with incoming lowercase cached keys
          for (const lcKey of Object.keys(cached)) {
            // Build the Title-Case equivalent: "anthropic-version" → "Anthropic-Version"
            const titleKey = lcKey.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

            // Special handling for Anthropic-Beta to preserve required flags like OAuth
            if (lcKey === "anthropic-beta") {
              const staticBetaStr = headers[titleKey] || headers[lcKey] || "";
              const staticFlags = new Set(staticBetaStr.split(",").map(f => f.trim()).filter(Boolean));
              const cachedFlags = new Set(cached[lcKey].split(",").map(f => f.trim()).filter(Boolean));

              // Merge all static flags (which contain oauth, thinking, etc) into the cached ones
              for (const flag of staticFlags) {
                cachedFlags.add(flag);
              }

              cached[lcKey] = Array.from(cachedFlags).join(",");
            }

            if (titleKey !== lcKey && headers[titleKey] !== undefined) {
              delete headers[titleKey];
            }
          }
          Object.assign(headers, cached);
        }
        credentials.apiKey
          ? (headers["x-api-key"] = credentials.apiKey)
          : (headers["Authorization"] = `Bearer ${credentials.accessToken}`);
        break;
      }
      case "glm":
      case "kimi":
      case "minimax":
      case "minimax-cn":
      case "kimi-coding":
        headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
        if (this.provider === "kimi-coding") Object.assign(headers, buildKimiHeaders());
        break;
      default:
        if (this.provider?.startsWith?.("anthropic-compatible-")) {
          if (credentials.apiKey) {
            headers["x-api-key"] = credentials.apiKey;
          } else if (credentials.accessToken) {
            headers["Authorization"] = `Bearer ${credentials.accessToken}`;
          }
          if (!headers["anthropic-version"]) {
            headers["anthropic-version"] = "2023-06-01";
          }
        } else if (this.provider === "gitlab") {
          // GitLab Duo uses Bearer token (PAT with ai_features scope, or OAuth access token)
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        } else if (this.provider === "codebuddy") {
          const requestId = codeBuddyRequestId();
          const conversationId = codeBuddyRequestId();
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
          headers["Accept"] = "text/event-stream";
          headers["Content-Type"] = "application/json; charset=utf-8";
          headers["User-Agent"] = "CLI/2.105.2 CodeBuddy/2.105.2";
          // CLI spoofing headers for restricted account bypass
          headers["X-App"] = "cli";
          headers["X-Stainless-Runtime"] = "node";
          headers["X-Stainless-Lang"] = "js";
          headers["X-Stainless-Helper-Method"] = "stream";
          headers["X-Stainless-Retry-Count"] = "0";
          headers["X-Requested-With"] = "XMLHttpRequest";
          headers["X-Domain"] = credentials.providerSpecificData?.domain || "www.codebuddy.ai";
          headers["X-Request-ID"] = requestId;
          headers["X-Conversation-ID"] = conversationId;
          headers["X-Conversation-Request-ID"] = conversationId;
          headers["X-Conversation-Message-ID"] = requestId;
          headers["X-Agent-Intent"] = "craft";
          headers["X-IDE-Type"] = "CLI";
          headers["X-IDE-Name"] = "CLI";
          headers["X-IDE-Version"] = "2.105.2";
          headers["X-Private-Data"] = "false";
        } else if (this.provider === "kilocode") {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
          if (credentials.providerSpecificData?.orgId) {
            headers["X-Kilocode-OrganizationID"] = credentials.providerSpecificData.orgId;
          }
        } else if (this.provider === "cline") {
          Object.assign(headers, buildClineHeaders(credentials.apiKey || credentials.accessToken));
        } else if (this.config?.format === "claude") {
          // Generic claude-format provider (e.g. agentrouter): x-api-key + anthropic-version
          headers["x-api-key"] = credentials.apiKey || credentials.accessToken;
          if (!headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
        }
    }

    // Strip first-party Claude Code identity headers for non-Anthropic anthropic-compatible upstreams
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];
        // Strip claude-code-20250219 from Anthropic-Beta / anthropic-beta
        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshWithJSON(OAUTH_ENDPOINTS.anthropic.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.claude.clientId }, proxyOptions),
      codex: () => this.refreshWithForm(OAUTH_ENDPOINTS.openai.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.codex.clientId, scope: "openid profile email offline_access" }, proxyOptions),
      qwen: () => this.refreshWithForm(OAUTH_ENDPOINTS.qwen.token, { grant_type: "refresh_token", refresh_token: credentials.refreshToken, client_id: PROVIDERS.qwen.clientId }, proxyOptions),
      iflow: () => this.refreshIflow(credentials.refreshToken, proxyOptions),
      gemini: () => this.refreshGoogle(credentials.refreshToken, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      codebuddy: () => this.refreshCodeBuddy(credentials.refreshToken, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      "kimi-coding": () => this.refreshKimiCoding(credentials.refreshToken, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshIflow(refreshToken, proxyOptions = null) {
    const basicAuth = btoa(`${PROVIDERS.iflow.clientId}:${PROVIDERS.iflow.clientSecret}`);
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.iflow.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "Authorization": `Basic ${basicAuth}` },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: PROVIDERS.iflow.clientId, client_secret: PROVIDERS.iflow.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshGoogle(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.config.clientId, client_secret: this.config.clientSecret })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCodeBuddy(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.codebuddy.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
        "X-Requested-With": "XMLHttpRequest",
        "X-Domain": "www.codebuddy.ai",
        "X-Refresh-Token": refreshToken,
        "X-Auth-Refresh-Source": "plugin",
        "X-Product": "SaaS",
      },
      body: "{}"
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const accessToken = data?.accessToken || data?.access_token;
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: data?.refreshToken || data?.refresh_token || refreshToken,
      expiresIn: data?.expiresIn || data?.expires_in || 86400,
    };
  }

  async refreshCline(refreshToken, proxyOptions = null) {
    console.log('[DEBUG] Refreshing Cline token, refreshToken length:', refreshToken?.length);
    const response = await proxyAwareFetch("https://api.cline.bot/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);
    console.log('[DEBUG] Cline refresh response status:', response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.log('[DEBUG] Cline refresh error:', errorText);
      return null;
    }
    const payload = await response.json();
    console.log('[DEBUG] Cline refresh payload:', JSON.stringify(payload).substring(0, 200));
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    console.log('[DEBUG] Cline refresh success, expiresIn:', expiresIn);
    return { accessToken: data?.accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKimiCoding(refreshToken, proxyOptions = null) {
    const kimiHeaders = buildKimiHeaders();
    const response = await proxyAwareFetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "17e5f671-d194-4dfb-9706-5516cb48c098" })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {
    // Kilocode uses device code flow, no refresh token support
    return null;
  }
}

export default DefaultExecutor;
