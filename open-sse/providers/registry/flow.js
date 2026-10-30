// Google Flow (Veo 3.1 + omni-flash) through the user's own signed-in Chrome.
//
// Flow has no public REST API. Submit is reCAPTCHA-gated with a single-use
// token, so the only supported path is driving the real web app. 9Router owns
// that browser in src/lib/flow/bridge.js and this provider talks to it over
// loopback (see open-sse/handlers/videoProviders/flow.js).
//
// Credit table: support.google.com/flow/answer/16526234. Prices are per
// generation (clip), NOT per second: veo-lite/fast/quality cost the same for 4s
// and 8s, only omni-flash scales with duration and resolution. Durations a model
// does not offer are simply absent from the table, which is what validates them.
const DURATIONS = [4, 6, 8, 10];
const ASPECTS = ["16:9", "9:16"];

export const FLOW_VIDEO_MODELS = {
  "omni-flash": {
    name: "Omni Flash",
    durations: DURATIONS,
    aspects: ASPECTS,
    resolutions: ["360p", "720p"],
    maxRefs: 7,
    cost: {
      "360p": { 4: 4, 6: 5, 8: 6, 10: 7 },
      "720p": { 4: 7, 6: 10, 8: 12, 10: 15 },
    },
  },
  "veo-lite": { name: "Veo 3.1 Lite", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, cost: { default: { 4: 10, 6: 10, 8: 10 } } },
  "veo-fast": { name: "Veo 3.1 Fast", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, cost: { default: { 4: 20, 6: 20, 8: 20 } } },
  "veo-quality": { name: "Veo 3.1 Quality", durations: [8], aspects: ASPECTS, resolutions: [], maxRefs: 0, cost: { default: { 8: 100 } } },
  "veo-lite-lp": { name: "Veo 3.1 Lite (lower priority)", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, cost: { default: { 4: 0, 6: 0, 8: 0 } } },
};

/**
 * Credits Flow charges for one generation, or null when the combination is not
 * offered by that model (callers must treat null as "reject before submit",
 * never as "free").
 */
export function flowCreditCost(model, { duration, resolution } = {}) {
  const spec = FLOW_VIDEO_MODELS[model];
  if (!spec) return null;
  const d = Number(duration);
  if (!spec.durations.includes(d)) return null;
  const table = spec.resolutions.length ? spec.cost[resolution || spec.resolutions[0]] : spec.cost.default;
  const price = table?.[d];
  return typeof price === "number" ? price : null;
}

export default {
  id: "flow",
  alias: "flow",
  uiAlias: "flow",
  display: {
    name: "Google Flow (Veo)",
    icon: "movie",
    color: "#4285F4",
    textIcon: "GF",
    website: "https://flow.google.com",
    notice: {
      text: "Runs in the browser you already signed into Flow. Start it from the Flow page; run `gflow auth login --browser chrome` once if no session exists.",
    },
  },
  category: "webCookie",
  authType: "none",
  noAuth: true,
  authModes: ["none"],
  transport: null,
  models: Object.entries(FLOW_VIDEO_MODELS).map(([id, spec]) => ({
    id,
    name: spec.name,
    kind: "video",
    params: ["duration", "aspect_ratio", ...(spec.resolutions.length ? ["resolution"] : [])],
  })),
  serviceKinds: ["video"],
  videoConfig: {
    // No reachable upstream and no credentials: the adapter answers in-process
    // from src/lib/flow/bridge.js, which drives the signed-in browser. The
    // router skips account rotation for noAuth providers.
    baseUrl: "flow://local-bridge",
    noAuth: true,
    models: FLOW_VIDEO_MODELS,
  },
};
