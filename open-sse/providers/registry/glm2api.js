export default {
  id: "glm2api",
  priority: 125,
  alias: "glm2api",
  display: {
    name: "GLM2API Local",
    icon: "terminal",
    color: "#1D4ED8",
    textIcon: "G2",
    website: "https://github.com/LX-u0/glm2api",
    notice: {
      text: "Requires a separately running glm2api service. If SERVER_API_KEYS is empty in glm2api, any dummy API key can be used.",
      apiKeyUrl: "https://github.com/LX-u0/glm2api#readme",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "http://127.0.0.1:8000/v1/responses",
    format: "openai-responses",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  transports: [
    {
      format: "openai-responses",
      baseUrl: "http://127.0.0.1:8000/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai",
      baseUrl: "http://127.0.0.1:8000/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "glm-5.2-flash", name: "GLM 5.2 Flash" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.2-think", name: "GLM 5.2 Think" },
    { id: "glm-5.2-search", name: "GLM 5.2 Search" },
  ],
  serviceKinds: ["llm"],
};
