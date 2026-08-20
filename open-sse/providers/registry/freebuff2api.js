// Freebuff2api Provider Registry Entry
// Category: apikey (OpenAI-compatible gateway to a self-hosted freebuff2api server)
// Website: https://github.com/... (self-hosted gateway exposing freebuff/codebuff free models)
// The gateway (server.js on :8787) owns the account pool, proxy rotation, session
// lifecycle and quota. 9Router consumes it as a plain OpenAI-compatible endpoint:
//   GET  /v1/models  → dynamic model catalog (upstream free-agents + freebuff-models)
//   POST /v1/chat/completions → session-managed chat

export default {
  id: "freebuff2api",
  category: "apikey",
  alias: "freebuff2api",
  uiAlias: "fb2",
  priority: 51,
  hasFree: true,

  display: {
    name: "Freebuff2API",
    icon: "bolt",
    color: "#22C55E",
    textIcon: "F2",
    website: "https://www.codebuff.com",
    notice: {
      text: "Self-hosted freebuff2api gateway. Point it at your running freebuff2api server (default http://127.0.0.1:8787), paste its API key, and use the free DeepSeek V4 Flash / MiMo V2.5 models. The gateway manages accounts, sessions, proxies and quota.",
    },
  },

  authType: "apikey",
  authModes: ["apikey"],

  transport: {
    // Default self-hosted location; override per-connection via providerSpecificData.baseUrl
    baseUrl: "http://127.0.0.1:8787/v1/chat/completions",
    format: "openai",
    timeoutMs: 300000,
    stallTimeoutMs: 300000,
    // validate against /v1/models so Add API Key "Check" hits the gateway
    validateUrl: "http://127.0.0.1:8787/v1/models",
  },

  models: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", default: true },
    { id: "mimo/mimo-v2.5", name: "MiMo V2.5" },
  ],

  modelsFetcher: {
    url: "http://127.0.0.1:8787/v1/models",
    type: "openai",
  },

  features: {
    usage: true,
    usageApikey: true,
  },

  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000,
  },

  regions: ["global"],
  defaultRegion: "global",
};
