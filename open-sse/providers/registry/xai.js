export default {
  id: "xai",
  priority: 280,
  alias: "xai",
  display: {
    name: "xAI (Grok)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "XA",
    website: "https://x.ai",
    notice: {
      apiKeyUrl: "https://console.x.ai",
    },
  },
  category: "oauth",
  authModes: [
    "oauth",
    "apikey",
  ],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    validateUrl: "https://api.x.ai/v1/models",
    responsesUrl: "https://api.x.ai/v1/responses",
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
  },
  models: [
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    { id: "grok-code-fast-1", name: "Grok Code Fast" },
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-2-image-1212", name: "Grok 2 Image", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image", name: "Grok Imagine Image", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image-quality", name: "Grok Imagine Image Quality", params: ["n","response_format"], kind: "image" },
    { id: "grok-imagine-image-pro", name: "Grok Imagine Image Pro", params: ["n","response_format"], kind: "image" },
  ],
  serviceKinds: ["llm","imageToText","webSearch","image"],
  imageConfig: {
    baseUrl: "https://api.x.ai/v1/images/generations",
    editUrl: "https://api.x.ai/v1/images/edits",
    // whitelist for generations; adapter always injects `image` when present for edits
    bodyFields: ["model", "prompt", "n", "response_format", "image"],
  },
  searchViaChat: {
    defaultModel: "grok-4.20-reasoning",
    endpoint: "https://api.x.ai/v1/responses",
    pricingUrl: "https://x.ai/api#pricing",
  },
};
