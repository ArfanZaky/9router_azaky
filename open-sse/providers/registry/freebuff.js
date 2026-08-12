// Freebuff Provider Registry Entry
// Category: oauth (Google OAuth authentication)
// Website: https://freebuff.com

const FREEBUFF_CONFIG = {
  id: "freebuff",
  category: "oauth",
  uiAlias: "freebuff",
  priority: 50,
  hasFree: true,

  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#22C55E",
    website: "https://freebuff.com",
    notice: { signupUrl: "https://freebuff.com" },
  },

  authModes: ["oauth"],
  hasOAuth: true,

  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    timeoutMs: 300000,
    stallTimeoutMs: 300000,
  },

  models: [
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", default: true },
    { id: "mimo-v2.5", name: "Mimo V2.5" },
  ],

  features: {
    usage: true,
    usageApikey: false,
  },

  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000,
  },

  regions: ["global"],
  defaultRegion: "global",
};

export default FREEBUFF_CONFIG;
