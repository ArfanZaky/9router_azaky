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
    textIcon: "FB",
    website: "https://freebuff.com",
    notice: {
      text: "Free, ad-supported coding agent. Limited-region accounts can use DeepSeek V4 Flash and MiMo V2.5.",
      signupUrl: "https://freebuff.com",
    },
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
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", default: true },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
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
