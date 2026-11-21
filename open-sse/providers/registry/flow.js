// Google Flow (Veo 3.1 + omni-flash) through the user's own signed-in Chrome.
//
// Flow has no public REST API. Submit is reCAPTCHA-gated with a single-use
// token, so the only supported path is driving the real web app. 9Router owns
// that browser in src/lib/flow/bridge.js and this provider talks to it over
// loopback (see open-sse/handlers/videoProviders/flow.js).
//
// Credit table: support.google.com/flow/answer/16526234 (read 2026-11-21).
// Prices are per generation (clip): veo-lite/fast/quality cost the same for 4s
// and 8s, only omni-flash scales with duration and resolution. Durations a model
// does not offer are simply absent from the table, which is what validates them.
//
// Where Flow prices by plan (Veo 3.1 Lite: 5 for Ultra, 10 for everyone else;
// Veo 3.1 Fast: 10 / 20) the non-Ultra price is used. The gate must never
// approve a clip the account cannot pay for, and the accounts here are not Ultra.
//
// Durations stay at 4/6/8/10 even though Omni Flash 1.2 accepts 3–10s (3–15s on
// a subscription): `gflow video t2v --duration` only offers those four.
const DURATIONS = [4, 6, 8, 10];
const ASPECTS = ["16:9", "9:16"];

// "On December 5, 2026, Veo 3.1 Fast, Veo 3.1 Quality, and Omni Flash 1.1 will
// be retired." From that day Flow only renders Omni Flash 1.2 and Veo 3.1 Lite.
export const FLOW_RETIREMENT_DATE = "2026-12-05";

// Omni Flash 1.1, what `omni-flash` was billed until the retirement: every 4s
// 720p render recorded locally up to 2026-11-05 cost exactly 7 credits.
const OMNI_FLASH_1_1_COST = {
  "360p": { 4: 4, 6: 5, 8: 6, 10: 7 },
  "720p": { 4: 7, 6: 10, 8: 12, 10: 15 },
};

// Omni Flash 1.2: 1 credit/s at 360p and 3 credits/s at 720p up to 10s; each
// second from 11 to 15 (Google AI Plus/Pro/Ultra only) costs 2 and 6.
const OMNI_1_2_DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3); // 3..15
const omni12Price = (d, base, extra) => (d <= 10 ? d * base : 10 * base + (d - 10) * extra);
const omni12Table = (durations, base, extra) => Object.fromEntries(durations.map((d) => [d, omni12Price(d, base, extra)]));
const OMNI_FLASH_1_2_COST = {
  "360p": omni12Table(OMNI_1_2_DURATIONS, 1, 2),
  "720p": omni12Table(OMNI_1_2_DURATIONS, 3, 6),
};

export const FLOW_IMAGE_MODELS = {
  nano2: { name: "Nano Banana 2.1", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], maxRefs: 10 },
  "nano-pro": { name: "Nano Banana Pro", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], maxRefs: 10 },
  "nano2-lite": { name: "Nano Banana 2 Lite", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], maxRefs: 3 },
  // Still accepted by gflow, but no longer in Flow's own model menu.
  imagen4: { name: "Imagen 4 (legacy)", aspects: ["16:9", "9:16", "1:1", "4:3", "3:4"], maxRefs: 3 },
};

export const FLOW_VIDEO_MODELS = {
  "omni-flash": {
    name: "Omni Flash",
    durations: DURATIONS,
    aspects: ASPECTS,
    resolutions: ["360p", "720p"],
    maxRefs: 7,
    cost: OMNI_FLASH_1_1_COST,
    // gflow's `omni-flash` is Omni Flash 1.1, which Flow retires on 2026-12-05.
    // From that day the id keeps working: it is sent as `omni-1.2-flash` and
    // priced as 1.2, so clients and saved jobs that say `omni-flash` do not break.
    costSchedule: [{ from: FLOW_RETIREMENT_DATE, cost: OMNI_FLASH_1_2_COST }],
    cliModelSchedule: [{ from: FLOW_RETIREMENT_DATE, cliModel: "omni-1.2-flash" }],
  },
  "omni-1.2-flash": {
    name: "Omni Flash 1.2",
    // 11-15s need a Google AI Plus/Pro/Ultra plan; Flow refuses them otherwise.
    durations: OMNI_1_2_DURATIONS,
    aspects: ASPECTS,
    resolutions: ["360p", "720p"],
    maxRefs: 7,
    cost: OMNI_FLASH_1_2_COST,
  },
  "veo-lite": { name: "Veo 3.1 Lite", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, cost: { default: { 4: 10, 6: 10, 8: 10 } } },
  "veo-fast": { name: "Veo 3.1 Fast", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, retiresOn: FLOW_RETIREMENT_DATE, cost: { default: { 4: 20, 6: 20, 8: 20 } } },
  "veo-quality": { name: "Veo 3.1 Quality", durations: [8], aspects: ASPECTS, resolutions: [], maxRefs: 0, retiresOn: FLOW_RETIREMENT_DATE, cost: { default: { 8: 100 } } },
  // 0 credits only for Ultra 20x subscribers and family plan managers.
  "veo-lite-lp": { name: "Veo 3.1 Lite (lower priority, Ultra 20x)", durations: [4, 6, 8], aspects: ASPECTS, resolutions: [], maxRefs: 3, cost: { default: { 4: 0, 6: 0, 8: 0 } } },
};

/** UTC calendar day of `at`, comparable with the YYYY-MM-DD dates above. */
function dayOf(at = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

/**
 * The model id to hand to gflow / the composer for `model` on day `at`: the
 * registry id itself, or its scheduled successor once that has started.
 */
export function flowCliModel(model, { at = new Date() } = {}) {
  const spec = FLOW_VIDEO_MODELS[model];
  if (!spec) return model;
  const day = dayOf(at);
  let cliModel = model;
  for (const entry of spec.cliModelSchedule || []) {
    if (day >= entry.from) cliModel = entry.cliModel;
  }
  return cliModel;
}

/** True once Flow has retired `model` (it would refuse or silently swap it). */
export function isFlowModelRetired(model, { at = new Date() } = {}) {
  const retiresOn = FLOW_VIDEO_MODELS[model]?.retiresOn;
  return Boolean(retiresOn) && dayOf(at) >= retiresOn;
}

/** The cost table in force on `at`: the latest scheduled entry that has started. */
function costTableAt(spec, at) {
  const day = dayOf(at);
  let cost = spec.cost;
  for (const entry of spec.costSchedule || []) {
    if (day >= entry.from) cost = entry.cost;
  }
  return cost;
}

/**
 * Credits Flow charges for one generation, or null when the combination is not
 * offered by that model (callers must treat null as "reject before submit",
 * never as "free"). `at` picks the price in force on that day.
 */
export function flowCreditCost(model, { duration, resolution, at = new Date() } = {}) {
  const spec = FLOW_VIDEO_MODELS[model];
  if (!spec) return null;
  const d = Number(duration);
  if (!spec.durations.includes(d)) return null;
  const cost = costTableAt(spec, at);
  const table = spec.resolutions.length ? cost[resolution || spec.resolutions[0]] : cost.default;
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
  models: [
    ...Object.entries(FLOW_VIDEO_MODELS).map(([id, spec]) => ({
      id,
      name: spec.name,
      kind: "video",
      params: ["duration", "aspect_ratio", ...(spec.resolutions.length ? ["resolution"] : [])],
    })),
    ...Object.entries(FLOW_IMAGE_MODELS).map(([id, spec]) => ({
      id,
      name: spec.name,
      kind: "image",
      params: ["aspect_ratio"],
    })),
  ],
  serviceKinds: ["video", "image"],
  imageConfig: {
    baseUrl: "flow://local-bridge",
    noAuth: true,
    models: FLOW_IMAGE_MODELS,
  },
  videoConfig: {
    // No reachable upstream and no credentials: the adapter answers in-process
    // from src/lib/flow/bridge.js, which drives the signed-in browser. The
    // router skips account rotation for noAuth providers.
    baseUrl: "flow://local-bridge",
    noAuth: true,
    models: FLOW_VIDEO_MODELS,
  },
};
