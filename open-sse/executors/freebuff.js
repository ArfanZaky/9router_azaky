import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import {
  FREEBUFF_AGENT_RUNS_URL,
  FREEBUFF_CHAT_URL,
  FREEBUFF_CLI_USER_AGENT,
  FREEBUFF_MODELS,
  FREEBUFF_SESSION_URL,
  FREEBUFF_STOP_SEQUENCE,
  FREEBUFF_SYSTEM_MARKER,
  FREEBUFF_SYSTEM_PROMPT,
} from "../config/freebuffConstants.js";

function parseModel(model) {
  const shortId = String(model || "").split("/").pop();
  const config = FREEBUFF_MODELS[shortId];
  if (!config) throw new Error(`Unsupported Freebuff model: ${model}`);
  return config;
}

function injectSystemMarker(body) {
  const messages = Array.isArray(body?.messages)
    ? body.messages.map((message) => ({ ...message }))
    : [];
  const systemIndex = messages.findIndex((message) => message?.role === "system" || message?.role === "developer");

  if (systemIndex === -1) {
    messages.unshift({ role: "system", content: FREEBUFF_SYSTEM_PROMPT });
  } else {
    const message = messages[systemIndex];
    message.role = "system";
    if (typeof message.content === "string") {
      if (!message.content.startsWith(FREEBUFF_SYSTEM_MARKER)) {
        message.content = `${FREEBUFF_SYSTEM_PROMPT}\n\n${message.content}`;
      }
    } else if (Array.isArray(message.content)) {
      const firstText = message.content.find((part) => part?.type === "text");
      if (!firstText?.text?.startsWith(FREEBUFF_SYSTEM_MARKER)) {
        message.content = [{ type: "text", text: FREEBUFF_SYSTEM_PROMPT }, ...message.content];
      }
    } else {
      message.content = FREEBUFF_SYSTEM_PROMPT;
    }
  }

  return { ...body, messages };
}

async function readJson(response, operation) {
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) {
    throw new Error(`Freebuff ${operation} failed (${response.status}): ${data?.message || data?.error || text || response.statusText}`);
  }
  return data || {};
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS["freebuff"] || PROVIDERS.openai);
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return FREEBUFF_CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": FREEBUFF_CLI_USER_AGENT,
      ...this.config.headers,
    };
    if (credentials?.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    } else if (credentials?.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }
    if (credentials?.providerSpecificData?.userId) {
      headers["x-freebuff-acting-user-id"] = credentials.providerSpecificData.userId;
    }
    headers["Accept"] = "application/json, text/event-stream";
    return headers;
  }

  async request(url, credentials, options, proxyOptions) {
    return proxyAwareFetch(url, {
      ...options,
      headers: { ...this.buildHeaders(credentials, true), ...options.headers },
    }, proxyOptions);
  }

  async ensureSession(model, credentials, signal, proxyOptions) {
    let response = await this.request(FREEBUFF_SESSION_URL, credentials, { method: "GET", signal }, proxyOptions);
    let session = response.status === 404 ? { status: "none" } : await readJson(response, "session lookup");

    if (session.status === "active" && session.model === model && session.instanceId) return session;
    if ((session.status === "active" || session.status === "ended") && session.instanceId) {
      response = await this.request(FREEBUFF_SESSION_URL, credentials, { method: "DELETE", signal }, proxyOptions);
      if (response.status !== 404) await readJson(response, "session release");
    }

    response = await this.request(FREEBUFF_SESSION_URL, credentials, {
      method: "POST",
      headers: { "x-freebuff-model": model },
      body: "{}",
      signal,
    }, proxyOptions);
    session = await readJson(response, "session admission");
    if (session.status !== "active" || !session.instanceId) {
      throw new Error(`Freebuff session admission returned ${session.status || "an invalid response"}`);
    }
    return session;
  }

  async startRun(agentId, credentials, signal, proxyOptions) {
    const response = await this.request(FREEBUFF_AGENT_RUNS_URL, credentials, {
      method: "POST",
      body: JSON.stringify({ action: "START", agentId, ancestorRunIds: [] }),
      signal,
    }, proxyOptions);
    const data = await readJson(response, "agent run start");
    if (!data.runId) throw new Error("Freebuff agent run response did not include runId");
    return data.runId;
  }

  async execute({ model, body, credentials, signal, proxyOptions = null }) {
    const userId = credentials?.providerSpecificData?.userId;
    const modelConfig = parseModel(model);
    const session = await this.ensureSession(modelConfig.model, credentials, signal, proxyOptions);
    const runId = await this.startRun(modelConfig.agentId, credentials, signal, proxyOptions);
    const transformedBody = injectSystemMarker(body);
    transformedBody.model = modelConfig.model;
    transformedBody.stream = true;
    transformedBody.stop ??= [FREEBUFF_STOP_SEQUENCE];
    transformedBody.provider = { ...transformedBody.provider, data_collection: "deny" };
    transformedBody.codebuff_metadata = {
      freebuff_instance_id: session.instanceId,
      trace_session_id: crypto.randomUUID(),
      run_id: runId,
      client_id: Math.random().toString(36).substring(2, 15),
      cost_mode: "free",
    };

    const headers = this.buildHeaders(credentials, true);
    if (userId) headers["x-freebuff-acting-user-id"] = userId;
    headers["x-freebuff-model"] = modelConfig.model;
    headers["x-freebuff-instance-id"] = session.instanceId;
    const response = await proxyAwareFetch(FREEBUFF_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal,
    }, proxyOptions);
    return { response, url: FREEBUFF_CHAT_URL, headers, transformedBody };
  }
}

export const __test__ = { injectSystemMarker, parseModel };

export default FreebuffExecutor;
