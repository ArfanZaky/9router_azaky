/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's COSY-signed
 * inference endpoint at api3.qoder.sh, then unwraps Qoder's `{statusCodeValue,
 * body}` SSE envelope back into plain OpenAI SSE for the rest of the pipeline.
 *
 * Differences vs the previous placeholder:
 *   - URL is api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation
 *     with `&Encode=1` so we can ship the body through the WAF-bypass
 *     encoder.
 *   - Authentication is COSY (RSA + AES + MD5 + ~17 Cosy-* headers), not
 *     a static HMAC.
 *   - The request shape Qoder expects is non-trivial (chat_context with
 *     mirrored modelConfig, business block with stable IDs, system text
 *     hoisted out of the messages array). All ported from the reference.
 *   - Model identifier is one of the canonical Qoder keys (auto / ultimate /
 *     performance / efficient / lite + frontier "*model" ids); the
 *     translator layer feeds us "qoder/<key>" so we strip the prefix.
 *   - Per-model `model_config` is fetched live from /algo/api/v2/model/list
 *     and cached. Sending the wrong block silently downgrades to a
 *     different model upstream, so a missing entry is a hard error.
 */

import { qoderEncodeBody } from "../shared/qoder/encoding.js";
import { buildCosyHeaders } from "../shared/qoder/cosy.js";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import {
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_MAP,
} from "../shared/qoder/constants.js";
import { getQoderModelConfig, resolveQoderModels } from "../services/qoderModels.js";

/**
 * Hoist role:"system" messages out of the messages array (Qoder rejects
 * system in messages) and flatten any multipart content arrays.
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "", images: [] };
  }
  const systemParts = [];
  const out = [];
  const images = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const text = extractText(msg.content);
    const msgImages = extractImages(msg.content);
    for (const url of msgImages) images.push(url);
    if (msg.role === "system" || msg.role === "developer") {
      if (text) systemParts.push(text);
      continue;
    }
    let role = msg.role;
    let normalizedText = text;
    if (role === "tool") {
      role = "user";
      normalizedText = `[tool result ${msg.tool_call_id || msg.name || "unknown"}]\n${text}`;
    } else if (role === "function" || role === "model") {
      role = "assistant";
    } else if (role !== "user" && role !== "assistant") {
      role = "assistant";
    }
    if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const calls = msg.tool_calls.map((call) => {
        const fn = call?.function || {};
        return `${fn.name || "tool"}(${fn.arguments || ""})`;
      });
      normalizedText = [text, "[assistant requested tools]", ...calls].filter(Boolean).join("\n");
    }
    out.push({
      role,
      content: normalizedText,
      contents: [{ type: "text", text: normalizedText }],
    });
  }
  return { messages: out, systemText: systemParts.join("\n\n"), images };
}

function compactMessages(messages, maxInputTokens) {
  const budgetChars = Math.max(180000, Math.floor((Number(maxInputTokens) || 0) * 3.2));
  let total = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
  if (total <= budgetChars) return messages;
  const kept = [...messages];
  while (kept.length > 1 && total > budgetChars) {
    total -= kept.shift().content?.length || 0;
  }
  const marker = "[earlier context compacted]";
  return [{ role: "user", content: marker, contents: [{ type: "text", text: marker }] }, ...kept];
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

/**
 * Extract image URLs from a message content array. Supports both
 * `{type:"image_url", image_url:{url}}` (OpenAI) and
 * `{type:"image", source:{data|url}}` (Anthropic) shapes.
 * Returns array of url strings (http/https/data:).
 */
function extractImages(content) {
  if (!Array.isArray(content)) return [];
  const urls = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    let url = "";
    if (item.type === "image_url") {
      if (typeof item.image_url === "string") url = item.image_url;
      else if (item.image_url && typeof item.image_url.url === "string") url = item.image_url.url;
    } else if (item.type === "image" && item.source && typeof item.source === "object") {
      if (typeof item.source.url === "string") url = item.source.url;
      else if (item.source.data) {
        const mediaType = item.source.media_type || "image/png";
        url = `data:${mediaType};base64,${item.source.data}`;
      }
    }
    if (url && url.startsWith("data:") || url && /^https?:\/\//.test(url)) {
      urls.push(url);
    }
  }
  return urls;
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return "";
}

function stableHash(prefix, ...parts) {
  const h = createHash("sha256");
  h.update(prefix);
  for (const p of parts) {
    h.update("\0");
    h.update(String(p ?? ""));
  }
  return h.digest("hex").slice(0, 16);
}

function stableChatRecordId(model, messages, tools, maxTokens) {
  const h = createHash("sha256");
  h.update("qoder-record\0");
  h.update(String(model));
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if (m.role) { h.update("\0"); h.update(m.role); }
    if (typeof m.content === "string" && m.content) {
      h.update("\0"); h.update(m.content);
    }
  }
  if (tools) {
    h.update("\0");
    try { h.update(JSON.stringify(tools)); } catch {}
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

function truncate(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}...` : s || "";
}

function recoverFlattenedToolCalls(content, allowedNames) {
  if (typeof content !== "string") return null;
  const marker = /\[?assistant requested tools\]?/i.exec(content);
  if (!marker) return null;

  const source = content.slice(marker.index + marker[0].length);
  const toolCalls = [];
  const callStart = /(?:^|\n)\s*([A-Za-z_][\w.-]*)\s*\(/g;
  let match;
  while ((match = callStart.exec(source)) !== null) {
    const name = match[1];
    if (!allowedNames.has(name)) continue;
    const argsStart = callStart.lastIndex;
    let depth = 1;
    let inString = false;
    let escaped = false;
    let end = argsStart;
    for (; end < source.length; end++) {
      const char = source[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const rawArguments = source.slice(argsStart, end).trim();
    try { JSON.parse(rawArguments); } catch { continue; }
    toolCalls.push({
      index: toolCalls.length,
      id: `call_qoder_recovered_${toolCalls.length}`,
      type: "function",
      function: { name, arguments: rawArguments },
    });
    callStart.lastIndex = end + 1;
  }
  if (!toolCalls.length) return null;
  return { content: content.slice(0, marker.index).trimEnd(), toolCalls };
}

function recoverQoderToolCallStream(response, model, tools) {
  const allowedNames = new Set((Array.isArray(tools) ? tools : [])
    .map((tool) => tool?.function?.name)
    .filter(Boolean));
  if (!response.body || allowedNames.size === 0) return response;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const markerPattern = /\[?assistant requested tools\]?/i;
  const markerTailLength = 40;
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body.getReader();
      let buffer = "";
      // Transparent forwarding: content chunks flow straight through. We only
      // hold back a small trailing window (markerTailLength) so we can detect
      // the "[assistant requested tools]" marker that qoder emits when it wants
      // to call tools — if it appears we convert the flattened text into real
      // tool_calls. finish_reason / [DONE] are always forwarded unchanged.
      let probe = "";
      let recovering = false;
      let toolSource = "";
      let doneFrame = "";
      const forward = (wire) => controller.enqueue(encoder.encode(wire));

      const emitContent = (content) => {
        if (!content) return;
        const chunk = {
          id: `chatcmpl-qoder-recovered-${Date.now()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        };
        forward(`data: ${JSON.stringify(chunk)}\n\n`);
      };

      const finishRecovery = () => {
        const markerText = "assistant requested tools";
        const recovered = recoverFlattenedToolCalls(`${markerText}${toolSource}`, allowedNames);
        if (!recovered) {
          emitContent(`${markerText}${toolSource}`);
          return false;
        }
        const id = `chatcmpl-qoder-recovered-${Date.now()}`;
        const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
        forward(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: recovered.toolCalls }, finish_reason: null }] })}\n\n`);
        forward(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
        return true;
      };

      const processFrame = (frame) => {
        const wire = `${frame}\n\n`;
        const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:"));
        const data = line?.slice(5).trimStart();
        if (!data) {
          if (!recovering) forward(wire);
          return;
        }
        if (data === "[DONE]") {
          doneFrame = wire;
          if (recovering) {
            finishRecovery();
            // Append the original [DONE] after recovery so the client terminates.
            forward(wire);
          } else {
            if (probe) { emitContent(probe); probe = ""; }
            forward(wire);
          }
          return;
        }
        let chunk;
        try { chunk = JSON.parse(data); } catch {
          if (!recovering) forward(wire);
          return;
        }
        const delta = chunk.choices?.[0]?.delta || chunk.choices?.[0]?.message || {};
        // Native tool_calls — forward untouched.
        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
          if (probe) { emitContent(probe); probe = ""; }
          forward(wire);
          return;
        }
        // Terminal signal — always forward (finish_reason must reach client).
        const finishReason = chunk.choices?.[0]?.finish_reason;
        if (finishReason) {
          if (recovering) {
            // Capture the final chunk's content into toolSource before finishing.
            if (typeof delta.content === "string") toolSource += delta.content;
            const ok = finishRecovery();
            recovering = false;
            if (!ok) {
              // Couldn't parse tool calls — forward the content as-is.
              forward(wire);
            }
          } else {
            if (probe) { emitContent(probe); probe = ""; }
            forward(wire);
          }
          return;
        }
        if (recovering) {
          if (typeof delta.content === "string") toolSource += delta.content;
          return;
        }
        if (typeof delta.content !== "string") {
          forward(wire);
          return;
        }
        // Normal content: forward immediately for real-time streaming. If the
        // flattened tool marker shows up inline, recover it into tool_calls.
        const marker = markerPattern.exec(delta.content);
        if (marker) {
          const before = delta.content.slice(0, marker.index);
          toolSource = delta.content.slice(marker.index + marker[0].length);
          probe = "";
          recovering = true;
          if (before) {
            const chunkCopy = JSON.parse(JSON.stringify(chunk));
            chunkCopy.choices[0].delta.content = before;
            forward(`data: ${JSON.stringify(chunkCopy)}\n\n`);
          }
          return;
        }
        forward(wire);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
            const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] || "\n\n";
            processFrame(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + separator.length);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) processFrame(buffer.trimEnd());
        if (recovering) finishRecovery();
        else if (probe) emitContent(probe);
        if (!doneFrame) forward("data: [DONE]\n\n");
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/**
 * Map the OpenAI-style request body into the exact shape Qoder expects.
 */
async function buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal }) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");
  
  // Fetch model config from dynamic API instead of relying on static QODER_MODEL_MAP.
  // This allows support for new Qoder models (e.g., qmodel_latest) without code changes.
  let modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal });
  if (!modelConfig) {
    // Try a forced refresh once before giving up — the cache may simply
    // not be populated yet on first ever call for this credential.
    const refreshed = await resolveQoderModels(credentials, { forceRefresh: true, log, proxyOptions, signal });
    const retried = refreshed?.rawConfigs.get(qoderKey);
    if (!retried) {
      throw new Error(
        `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`,
      );
    }
    modelConfig = { ...retried, key: qoderKey };
  }

  // Reject disabled models up-front. Earlier versions sent the request anyway
  // and let upstream return 403 + a pricing URL, which surfaced as a generic
  // "qoder error 403" with no actionable hint. We now refuse pre-flight so
  // the caller knows exactly which model their plan can't use. Free-plan
  // accounts typically only get qmodel_latest (Qwen3.7-Max) enabled; every
  // other key reports enable:false and would 403 server-side.
  if (modelConfig.enable === false) {
    const planTier = credentials?.providerSpecificData?.planTier || "unknown";
    const err = new Error(
      `qoder: model "${qoderKey}" is not enabled for this account (plan: ${planTier}). ` +
      `Try qmodel_latest, or upgrade at https://qoder.com/pricing.`,
    );
    err.status = 403;
    err.code = "model_not_enabled";
    throw err;
  }

  const normalized = normalizeMessages(body.messages || []);
  const messages = compactMessages(normalized.messages, modelConfig.max_input_tokens);
  const systemText = normalized.systemText;
  const images = normalized.images || [];
  const tools = body.tools;
  const isReasoning = !!modelConfig.is_reasoning;
  const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

  let maxTokens = 32_768;
  if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  if (typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (typeof body.max_completion_tokens === "number" && body.max_completion_tokens > 0 && body.max_completion_tokens < maxTokens) {
    maxTokens = body.max_completion_tokens;
  }

  const lastUser = lastUserText(messages);
  const psd = credentials.providerSpecificData || {};
  const sessionId = stableHash("qoder-session", psd.userId, qoderKey);
  const recordId = stableChatRecordId(qoderKey, messages, tools, maxTokens);

  return {
    qoderKey,
    payload: {
      request_id: uuidv4(),
      request_set_id: recordId,
      chat_record_id: recordId,
      session_id: sessionId,
      stream: true,
      chat_task: "FREE_INPUT",
      is_reply: true,
      is_retry: false,
      source: 1,
      version: "3",
      session_type: "qodercli",
      agent_id: "agent_common",
      task_id: "common",
      code_language: "",
      chat_prompt: "",
      image_urls: images.length ? images : null,
      aliyun_user_type: "",
      system: systemText,
      messages,
      tools: Array.isArray(tools) ? tools : [],
      parameters: { max_tokens: maxTokens },
      chat_context: {
        chatPrompt: "",
        imageUrls: images.length ? images : null,
        extra: {
          context: [],
          modelConfig: { key: qoderKey, is_reasoning: isReasoning },
          originalContent: lastUser,
        },
        features: [],
        text: lastUser,
      },
      model_config: modelConfig,
      business: {
        product: "cli",
        version: "1.0.0",
        type: "agent",
        stage: "start",
        id: uuidv4(),
        name: truncate(lastUser, 30),
        begin_at: Date.now(),
      },
    },
    modelConfig,
  };
}

async function inspectFirstQoderEvent(response) {
  if (!response.ok || !response.body) return { response };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let prefix = "";
  while (!prefix.includes("\n\n") && !prefix.includes("\r\n\r\n")) {
    const { done, value } = await reader.read();
    if (done) break;
    prefix += decoder.decode(value, { stream: true });
  }
  const firstLine = prefix.split(/\r?\n/).find((line) => line.trimStart().startsWith("data:"));
  let envelope = null;
  try { envelope = JSON.parse(firstLine?.replace(/^\s*data:\s*/, "") || ""); } catch {}
  const status = Number(envelope?.statusCodeValue) || 200;
  const inner = typeof envelope?.body === "string" ? envelope.body : "";
  const quota = (status === 402 || status === 403) && /(?:\b112\b|pricingUrl|quota|credits)/i.test(inner);
  if (quota || status === 504) {
    await reader.cancel().catch(() => null);
    return { quota, retry504: status === 504 };
  }

  const encoder = new TextEncoder();
  const replayed = new ReadableStream({
    async start(controller) {
      if (prefix) controller.enqueue(encoder.encode(prefix));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return {
    response: new Response(replayed, { status: response.status, statusText: response.statusText, headers: response.headers }),
  };
}

/**
 * Wrap the upstream's `{statusCodeValue, body}` SSE envelope into plain
 * OpenAI SSE chunks the rest of the chatCore pipeline understands.
 *
 * Each upstream line looks like:
 *   data: {"statusCodeValue":200,"body":"{\"choices\":[{\"delta\":{...}}]}"}
 * The inner body is an OpenAI streaming chunk (or "[DONE]"). We unwrap it
 * and re-emit as `data: <inner>\n\n`. Errors become `data: [DONE]\n\n` plus
 * a synthetic OpenAI error chunk.
 */
function wrapQoderSSE(response, model) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let doneEmitted = false;

  // Process one already-extracted SSE line (no trailing newline). Returns
  // false when the line indicated end-of-stream so the caller can stop
  // forwarding any remaining chunks after [DONE].
  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("data:")) return;
    if (doneEmitted) return; // never forward chunks past stream end

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }

    let envelope;
    try { envelope = JSON.parse(data); } catch { return; }
    const statusVal = typeof envelope.statusCodeValue === "number" ? envelope.statusCodeValue : 200;
    const inner = typeof envelope.body === "string" ? envelope.body : "";
    if (statusVal !== 200) {
      const msg = inner || `upstream status ${statusVal}`;
      const errChunk = JSON.stringify({
        id: `qoder-error-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: `\n[qoder error ${statusVal}: ${truncate(msg, 200)}]` }, finish_reason: "stop" }],
      });
      controller.enqueue(encoder.encode(`data: ${errChunk}\n\n`));
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }
    if (!inner) return;
    if (inner === "[DONE]") {
      controller.enqueue(encoder.encode(SSE_DONE));
      doneEmitted = true;
      return;
    }
    // Inner is an OpenAI-shaped chunk. Forward as-is — reasoning models
    // (qmodel_38max etc) stream `delta.reasoning_content` which
    // @ai-sdk/openai-compatible clients (opencode) render as a separate
    // "reasoning" section; promoting it into `content` earlier made opencode
    // treat mid-stream thinking as the final answer and "stop" early.
    const sanitized = inner.replace(/\r?\n/g, "");
    controller.enqueue(encoder.encode(`data: ${sanitized}\n\n`));
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line, controller);
      }
    },
    flush(controller) {
      // Finalize the decoder so any pending multi-byte sequence is
      // released into `buffer` instead of being silently dropped.
      buffer += decoder.decode();
      // Drain any trailing line that arrived without a terminating newline
      // (e.g. upstream closed the socket immediately after the last write,
      // or a CDN stripped the final CRLF). Without this, the chunk that
      // carries finish_reason is silently lost.
      if (buffer.length > 0) {
        processLine(buffer, controller);
        buffer = "";
      }
      if (!doneEmitted) {
        controller.enqueue(encoder.encode(SSE_DONE));
        doneEmitted = true;
      }
    },
  });

  const transformed = response.body.pipeThrough(transform);
  // Build a Response with passable headers; the streaming handler reads
  // `.body` as a ReadableStream regardless of Content-Type.
  return new Response(transformed, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  buildUrl() {
    return QODER_CHAT_URL_ENCODED;
  }

  // Override execute entirely — Qoder needs:
  //   - body built from translated chat completion payload
  //   - body encoded with QoderEncodeBody before signing
  //   - COSY headers built from the *encoded* body bytes
  //   - response stream re-wrapped from {statusCodeValue, body} to OpenAI SSE
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();

    const psd = credentials?.providerSpecificData || {};
    if (!psd.userId) {
      // No user id → no way to sign. Surface a 401 so the dashboard nudges
      // the user back to OAuth.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing userId; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }
    if (!credentials?.accessToken) {
      // Same shape as the userId guard — clean 401 so chatCore reports
      // "reconnect" rather than bubbling cosy.js's synchronous throw as 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing accessToken; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    let qoderKey;
    let payload;
    try {
      ({ qoderKey, payload } = await buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal }));
    } catch (err) {
      const status = typeof err?.status === "number" ? err.status : 400;
      const fakeResp = new Response(
        JSON.stringify({ error: { message: err.message, code: err?.code } }),
        { status, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
    const encodedBodyStr = qoderEncodeBody(plainBody);
    const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

    const modelSource = (payload.model_config && payload.model_config.source) || "system";
    let headers = {};
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        headers = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Model-Key": qoderKey,
          "X-Model-Source": modelSource,
          "Accept-Encoding": "identity",
          ...buildCosyHeaders(encodedBodyBuf, url, {
            userId: psd.userId,
            authToken: credentials.accessToken,
            name: credentials.displayName || "",
            email: credentials.email || "",
            machineId: psd.machineCode || psd.machineId || "",
            machineToken: psd.machineToken || "",
            machineType: psd.machineType || "",
          }),
        };
      } catch (err) {
        const fakeResp = new Response(JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }), { status: 401, headers: { "Content-Type": "application/json" } });
        return { response: fakeResp, url, headers: {}, transformedBody: body };
      }

      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;
      try {
        response = await proxyAwareFetch(url, { method: "POST", headers, body: encodedBodyBuf, signal: mergedSignal }, proxyOptions);
      } finally {
        clearTimeout(connectTimer);
      }
      if (response.status === 504 && attempt === 0) {
        await response.body?.cancel().catch(() => null);
        continue;
      }
      const inspected = await inspectFirstQoderEvent(response);
      if (inspected.retry504 && attempt === 0) continue;
      if (inspected.quota) {
        response = new Response(JSON.stringify({ error: { message: "qoder quota exhausted", type: "insufficient_quota", code: "qoder_quota_exhausted" } }), { status: 403, headers: { "Content-Type": "application/json" } });
      } else if (inspected.retry504) {
        response = new Response(JSON.stringify({ error: { message: "qoder upstream timeout", type: "upstream_error", code: "qoder_upstream_timeout" } }), { status: 504, headers: { "Content-Type": "application/json" } });
      } else {
        response = inspected.response;
      }
      break;
    }

    if (!response.ok) {
      // Pass error response through unchanged so chatCore can capture it.
      return { response, url, headers, transformedBody: payload };
    }

    const wrapped = wrapQoderSSE(response, `qoder/${qoderKey}`);
    const recovered = recoverQoderToolCallStream(wrapped, `qoder/${qoderKey}`, body.tools);
    return { response: recovered, url, headers, transformedBody: payload };
  }

  // Qoder device tokens don't refresh through OAuth — the upstream returns
  // 403 for our flow. Surfacing failure via 401-on-chat is enough; the
  // dashboard tells users to re-login when their token expires (~30 days).
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default QoderExecutor;

// Internals exposed for unit tests. Not part of the public API — callers
// should import QoderExecutor and use its public methods.
export const __test__ = {
  normalizeMessages,
  compactMessages,
  inspectFirstQoderEvent,
  recoverFlattenedToolCalls,
  recoverQoderToolCallStream,
  wrapQoderSSE,
  buildQoderRequestBody,
  extractText,
  extractImages,
};
