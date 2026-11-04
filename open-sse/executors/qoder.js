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
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { FETCH_CONNECT_TIMEOUT_MS, HTTP_STATUS } from "../config/runtimeConfig.js";
import {
  QODER_CHAT_SIG_PATH,
  QODER_CONTEXT_TIER_ENV,
  getQoderStaticModelConfig,
  qoderInferenceBase,
} from "../shared/qoder/constants.js";
import { getQoderModelConfig, resolveQoderModels, isQoderPat, resolveQoderCredentials } from "../services/qoderModels.js";
import { OPENAI_BLOCK, CLAUDE_BLOCK } from "../translator/schema/blocks.js";
import { encodeDataUri } from "../translator/concerns/image.js";
import { buildCosyHeaders, deriveMachineId } from "../shared/qoder/cosy.js";
import {
  computeQoderQueueDelayMs,
  isQoderQueuedBody,
  parseQoderQueueInfo,
  parseQoderQueueStatus,
  qoderQueueMaxWaitMs,
  qoderQueueStatusUrl,
} from "../shared/qoder/queue.js";
import { createQoderSseCoalescer } from "../shared/qoder/sse.js";
import { rewriteQoderMessageAttachments } from "../shared/qoder/attachments.js";
import { resolveQoderContextTier, applyQoderContextTier } from "../shared/qoder/contextTier.js";

/**
 * Hoist role:"system" messages out of the messages array (Qoder rejects
 * system in messages), flatten multipart content arrays, and pass native
 * OpenAI tool_calls / tool results through untouched.
 *
 * Native passthrough matters: an earlier version flattened assistant
 * tool_calls into text ("[assistant requested tools]\nname(args)") and
 * wrapped tool results ("[tool result id]\n..."). Qoder mirrored that
 * flattened shape back in its output, and the "[assistant requested tools]"
 * marker leaked as content, making opencode treat the tool request as the
 * final answer and stop. Verified live: Qoder accepts native `tool_calls`
 * arrays and `role:"tool"` messages (HTTP 200, normal streaming), and emits
 * native `delta.tool_calls` when given native history.
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
    if (msg.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: msg.tool_call_id || msg.name || "",
        content: text,
        contents: [{ type: "text", text }],
      });
      continue;
    }
    let role = msg.role;
    let normalizedText = text;
    if (role === "function" || role === "model") {
      role = "assistant";
    } else if (role !== "user" && role !== "assistant") {
      role = "assistant";
    }
    const message = {
      role,
      content: normalizedText,
      contents: [{ type: "text", text: normalizedText }],
    };
    if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Keep native tool_calls — see module comment. Flattening to text is
      // what taught Qoder to echo the "[assistant requested tools]" marker.
      message.tool_calls = msg.tool_calls.map((call, index) => {
        const fn = call?.function || {};
        const args = fn.arguments;
        return {
          id: call.id || `call_qoder_${index}`,
          type: "function",
          function: {
            name: fn.name || "tool",
            arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
          },
        };
      });
    }
    out.push(message);
  }
  return { messages: out, systemText: systemParts.join("\n\n"), images };
}

function compactMessages(messages, maxInputTokens) {
  const budgetChars = Math.max(180000, Math.floor((Number(maxInputTokens) || 0) * 3.2));
  const size = (message) =>
    (message?.content?.length || 0) +
    (Array.isArray(message?.tool_calls)
      ? message.tool_calls.reduce((sum, call) => sum + (call?.function?.arguments?.length || 0), 0)
      : 0);
  let total = messages.reduce((sum, message) => sum + size(message), 0);
  if (total <= budgetChars) return messages;
  const kept = [...messages];
  while (kept.length > 1 && total > budgetChars) {
    total -= size(kept[0]);
    kept.shift();
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
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return extractText(m.content);
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
    } else if (Array.isArray(m.content)) {
      // Include image refs so the same prompt with a different image gets
      // a distinct chat_record_id.
      h.update("\0");
      try { h.update(JSON.stringify(m.content)); } catch {}
    }
  }
  if (tools) {
    h.update("\0");
    try { h.update(JSON.stringify(tools)); } catch {}
  }
  h.update(`\0mt=${maxTokens}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Sleep that aborts with the caller's signal, so a client hanging up during a
 * long queue wait releases the request instead of holding it for the budget.
 */
function sleep(ms, signal) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
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
          if (recovering) recovering = false;
          if (probe) { emitContent(probe); probe = ""; }
          forward(wire);
          return;
        }
        // Terminal signal — always forward (finish_reason must reach client).
        const finishReason = chunk.choices?.[0]?.finish_reason;
        const content = typeof delta.content === "string" ? delta.content : null;

        // Content/marker recovery runs BEFORE the finish_reason check. Qoder
        // often bundles the whole flattened "[assistant requested tools]"
        // block together with finish_reason into one final chunk; the old
        // ordering short-circuited on finish_reason first and forwarded the
        // raw marker text as content, making opencode treat the tool request
        // as the final answer and stop.
        let forwarded = false;
        if (content) {
          if (recovering) {
            toolSource += content;
          } else {
            const marker = markerPattern.exec(content);
            if (marker) {
              const before = content.slice(0, marker.index);
              toolSource = content.slice(marker.index + marker[0].length);
              recovering = true;
              if (before) emitContent(before);
            } else {
              forward(wire);
              forwarded = true;
            }
          }
        } else if (!recovering) {
          forward(wire);
          forwarded = true;
        }

        if (finishReason) {
          if (recovering) {
            const ok = finishRecovery();
            recovering = false;
            toolSource = "";
            if (ok) {
              // finishRecovery already emitted tool_calls + finish_reason
              // "tool_calls". Forwarding the original "stop" chunk here would
              // give the client a second terminal signal — treat it as
              // consumed so the client sees exactly one finish_reason.
              return;
            }
            // Couldn't parse tool calls — finishRecovery re-emitted the
            // flattened text as content; forward only the terminal signal so
            // finish_reason reaches the client without duplicating content.
            const terminal = {
              id: chunk.id,
              object: chunk.object,
              created: chunk.created,
              model: chunk.model,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            };
            if (chunk.usage) terminal.usage = chunk.usage;
            forward(`data: ${JSON.stringify(terminal)}\n\n`);
          } else if (!forwarded) {
            forward(wire);
          }
          return;
        }

        // Non-terminal frames: content withheld for recovery waits for the
        // rest of the tool block. Everything else has already been forwarded.
        if (recovering) return;
        if (!forwarded) forward(wire);
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
async function buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal, uploadFn = null, region = "intl" }) {
  const qoderKey = String(model || "").replace(/^qoder\//, "");

  // Fetch model config from dynamic API instead of relying on static QODER_MODEL_MAP.
  // This allows support for new Qoder models (e.g., qmodel_latest) without code changes.
  let modelConfig = await getQoderModelConfig(credentials, qoderKey, { log, proxyOptions, signal, region });
  if (!modelConfig) {
    // Try a forced refresh once before giving up — the cache may simply
    // not be populated yet on first ever call for this credential.
    const refreshed = await resolveQoderModels(credentials, { forceRefresh: true, log, proxyOptions, signal, region });
    const retried = refreshed?.rawConfigs.get(qoderKey);
    if (retried) {
      modelConfig = { ...retried, key: qoderKey };
    } else {
      // Last resort: a static block for models the per-account catalog omits.
      // Sonus (smodel) / Cantus (cmodel) are the known cases — the chat
      // endpoint accepts them even when /model/list never mentions them, so
      // refusing here would make an available model look broken.
      modelConfig = getQoderStaticModelConfig(qoderKey);
      if (!modelConfig) {
        throw new Error(
          `qoder: model_config for "${qoderKey}" not yet known (run a model list fetch or check upstream connectivity)`,
        );
      }
      log?.info?.("QODER", `using static model_config for "${qoderKey}" (absent from the account catalog)`);
    }
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

  // Upstream attachment rewrite: deep-clone incoming messages and rewrite
  // file/image attachments to Qoder's upload API before normalizing.
  const incoming = Array.isArray(body.messages)
    ? body.messages.map((m) => {
      if (!m || typeof m !== "object") return m;
      return {
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((b) => (b && typeof b === "object" ? { ...b } : b))
          : m.content,
      };
    })
    : [];
  try {
    await rewriteQoderMessageAttachments(incoming, {
      credentials,
      log,
      proxyOptions,
      signal,
      uploadFn,
    });
  } catch (err) {
    log?.warn?.("QODER", `attachment rewrite failed: ${err.message}`);
  }

  const normalized = normalizeMessages(incoming);
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

  // Context-window tier (200K/400K/1M): the IDE picks one from model_config.context_config;
  // qodercli-style requests default to the smallest. Escalate when the prompt no longer fits.
  const tierChoice = resolveQoderContextTier(
    modelConfig,
    { system: systemText, messages, tools },
    { preference: process.env[QODER_CONTEXT_TIER_ENV] },
  );
  if (tierChoice) {
    log?.info?.(
      "QODER",
      `context tier ${tierChoice.tier.name} (${tierChoice.tier.tokenCount} tokens, ${tierChoice.reason}) for ~${tierChoice.estimatedTokens} prompt tokens`,
    );
  }

  const built = {
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
  if (tierChoice) applyQoderContextTier(built.payload, tierChoice.tier);
  return built;
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
 * Check if a qoder error message indicates a billing/quota block.
 *
 * Signatures: code 110 (billing daily count exceeded), code 112 (quota
 * exhausted), or a `pricingUrl` field.
 *
 * Code 10605 is deliberately NOT here. It is the model-queue throttle
 * (`isQueued` / `RESOURCE_LIMIT`), a transient capacity signal: the model is
 * briefly unavailable and the very same request succeeds once it drains. The
 * billing branch turns the frame into a 403, chatCore reads 403 as
 * insufficient_quota and locks the model for minutes, so a queued request used
 * to fail permanently instead of waiting ~30s. See shared/qoder/queue.js.
 */
function isBillingBlock(inner) {
  if (!inner || typeof inner !== "string") return false;
  const lowerMsg = inner.toLowerCase();
  if (lowerMsg.includes("pricingurl")) return true;
  // Parsed code preferred over regex: matches numeric or string "110"/"112".
  try {
    const parsed = JSON.parse(inner);
    const code = String(parsed?.code ?? "");
    if (code === "110" || code === "112") return true;
  } catch { /* not JSON — fall through to legacy shape match */ }
  // Match legacy exact shape: {"code":"112",...}.
  return /"code"\s*:\s*"112"/.test(inner);
}

/**
 * Peek the first SSE data line to detect upstream errors before piping.
 * Returns { isError, isBilling, statusVal, message, consumed } — `consumed` is every
 * byte read so far (including the peeked line) so the caller can re-process
 * it and nothing is dropped from the stream.
 */
async function peekFirstQoderFrame(reader, decoder) {
  let consumed = "";
  let offset = 0;
  let upstreamDone = false;
  while (true) {
    let nl = consumed.indexOf("\n", offset);
    if (nl === -1 && !upstreamDone) {
      const { done, value } = await reader.read();
      upstreamDone = done;
      consumed += done ? decoder.decode() : decoder.decode(value, { stream: true });
      continue;
    }
    if (offset >= consumed.length) return { isError: false, consumed, upstreamDone };
    if (nl === -1) nl = consumed.length;

    const line = consumed.slice(offset, nl).replace(/\r$/, "").trim();
    offset = nl + 1;
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trimStart();
    if (data === "[DONE]") return { isError: false, consumed, upstreamDone };

    let envelope;
    try { envelope = JSON.parse(data); } catch { return { isError: false, consumed, upstreamDone }; }

    // statusCodeValue is documented numeric, but accept numeric strings defensively.
    const raw = Number(envelope?.statusCodeValue);
    const statusVal = Number.isNaN(raw) ? 200 : raw;
    const inner = typeof envelope?.body === "string"
      ? envelope.body
      : envelope?.body != null ? JSON.stringify(envelope.body) : "";

    if (statusVal !== 200) {
      return { isError: true, isBilling: isBillingBlock(inner), statusVal, message: inner || `upstream status ${statusVal}` };
    }
    return { isError: false, consumed, upstreamDone };
  }
}

/**
 * Wrap the upstream's `{statusCodeValue, body}` SSE envelope into plain
 * OpenAI SSE chunks the rest of the chatCore pipeline understands.
 *
 * Each upstream line looks like:
 *   data: {"statusCodeValue":200,"body":"{\"choices\":[{\"delta\":{...}}]}"}
 * The inner body is an OpenAI streaming chunk (or "[DONE]"). We unwrap it
 * and re-emit as `data: <inner>\n\n`. First-frame errors become HTTP errors;
 * errors after streaming starts retain the synthetic chunk + [DONE] path.
 *
 * Critical: Qoder's SSE often keeps the socket open after the terminal
 * [DONE]/error frame (agent keepalive). Non-streaming clients drain via
 * response.text() which hangs until the socket closes — so on terminal
 * events we cancel the upstream reader and close our stream immediately.
 *
 * Usage: Qoder puts finish_reason on `delta` and sends token counts on a
 * later `choices: []` frame. Downstream OpenAI/Claude clients only read
 * usage from the finish chunk, so we coalesce those two frames (see
 * createQoderSseCoalescer) before forwarding.
 *
 * Peek the first frame for errors before committing to HTTP 200. Preserve
 * upstream error statuses so chatCore can handle failures instead of recording
 * error text as a successful completion. Billing blocks retain the existing
 * 403 mapping for quota/account fallback.
 */
async function wrapQoderSSE(response, model, log = null) {
  if (!response.ok || !response.body) return response;

  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  // Detect errors before returning a successful streaming response.
  const peek = await peekFirstQoderFrame(reader, decoder);
  if (peek.isError) {
    await reader.cancel().catch(() => {});
    const status = peek.isBilling
      ? HTTP_STATUS.FORBIDDEN
      : Number.isInteger(peek.statusVal) && peek.statusVal >= HTTP_STATUS.BAD_REQUEST && peek.statusVal <= 599
        ? peek.statusVal : HTTP_STATUS.BAD_GATEWAY;
    return new Response(
      JSON.stringify({ error: { message: peek.message, code: peek.statusVal } }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }

  // Normal flow: re-process every byte the peek consumed, then continue.
  let buffer = peek.consumed || "";
  const upstreamDrained = peek.upstreamDone === true;
  const encoder = new TextEncoder();
  let doneEmitted = false;
  const coalescer = createQoderSseCoalescer({ model, encoder, sseDone: SSE_DONE });

  const syncDone = () => {
    if (coalescer.doneEmitted) doneEmitted = true;
  };

  // Process one already-extracted SSE line (no trailing newline).
  const processLine = (line, controller) => {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("data:")) return;
    if (doneEmitted) return;

    const data = trimmed.slice(5).trimStart();
    if (data === "[DONE]") {
      coalescer.flush(controller);
      syncDone();
      return;
    }

    let envelope;
    try { envelope = JSON.parse(data); } catch { return; }
    const statusVal = Number(envelope.statusCodeValue) || 200;
    const inner = typeof envelope.body === "string"
      ? envelope.body
      : envelope.body != null ? JSON.stringify(envelope.body) : "";
    if (statusVal !== 200) {
      // Always visible: error envelopes are rare and worth one stderr line at
        // any log level (response bodies carry no credentials).
      try {
        console.error(`[QODER] error envelope status=${statusVal} statusType=${typeof envelope.statusCodeValue} bodyType=${typeof envelope.body} body=${truncate(inner, 300)}`);
      } catch { /* logging must not break the stream */ }
      if (isBillingBlock(inner)) {
        // Billing/quota envelope at any stream position (peek only covers the
        // first frame): emit a structured error chunk, not fake assistant text.
        // parseSSEToOpenAIResponse understands chunk.error and turns it into a
        // non-200 result so chat.js locks the model and falls back. Streaming
        // clients receive a real SSE error instead of "[qoder error ...]" text.
        const errObj = JSON.stringify({
          error: {
            message: inner || `qoder billing block (${statusVal})`,
            code: "qoder_billing_block",
            status: 403,
            type: "quota_error",
          },
        });
        controller.enqueue(encoder.encode(`data: ${errObj}\n\n`));
        controller.enqueue(encoder.encode(SSE_DONE));
        doneEmitted = true;
        return;
      }
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
    coalescer.handleInner(inner, controller);
    syncDone();
  };

  const stream = new ReadableStream({
    // Use start()+loop (not pull): a pull that buffers a partial line without
    // enqueueing would never be re-invoked, hanging consumers like .text().
    async start(controller) {
      try {
        // Drain whatever the peek already pulled off the socket first.
        let nlSeed;
        while ((nlSeed = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlSeed);
          buffer = buffer.slice(nlSeed + 1);
          processLine(line, controller);
          if (doneEmitted) {
            await reader.cancel().catch(() => {});
            controller.close();
            return;
          }
        }
        if (upstreamDrained) {
          // Peek hit end-of-stream: flush any trailing partial line.
          buffer += decoder.decode();
          if (buffer.length > 0) {
            processLine(buffer, controller);
            buffer = "";
          }
        }

        while (!doneEmitted && !upstreamDrained) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (buffer.length > 0) {
              processLine(buffer, controller);
              buffer = "";
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            processLine(line, controller);
            if (doneEmitted) {
              // Terminal frame received — drop upstream keepalive and end.
              await reader.cancel().catch(() => {});
              controller.close();
              return;
            }
          }
        }
      } catch {
        // fall through to terminal [DONE] + close
      } finally {
        if (!doneEmitted) {
          try {
            coalescer.flush(controller);
            doneEmitted = true;
          } catch { /* already closed */ }
        }
        try { controller.close(); } catch { /* already closed */ }
        await reader.cancel().catch(() => {});
      }
    },
    cancel() {
      return reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

export class QoderExecutor extends BaseExecutor {
  constructor(provider = "qoder") {
    super(provider, PROVIDERS[provider]);
    this.region = provider === "qoder-cn" ? "cn" : "intl";
  }

  buildUrl(credentials) {
    return `${qoderInferenceBase(credentials, this.region)}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
  }

  // Override execute entirely — Qoder needs:
  //   - body built from translated chat completion payload
  //   - body encoded with QoderEncodeBody before signing
  //   - COSY headers built from the *encoded* body bytes
  //   - response stream re-wrapped from {statusCodeValue, body} to OpenAI SSE
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    // PAT (pt-...) → exchange for short-lived job token + resolve userId so
    // downstream COSY signing + catalog fetch work. Device tokens (dt-...) and
    // job tokens (jt-...) skip this and are used directly.
    const rawToken = credentials?.apiKey || credentials?.accessToken;
    if (isQoderPat(rawToken)) {
      try {
        credentials = await resolveQoderCredentials(credentials, proxyOptions, signal, this.region);
      } catch (err) {
        log?.error?.("QODER", `PAT exchange failed: ${err.message}`);
        const fakeResp = new Response(
          JSON.stringify({ error: { message: `qoder PAT exchange failed: ${err.message}` } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
        return { response: fakeResp, url: this.buildUrl(credentials), headers: {}, transformedBody: body };
      }
    }

    const url = this.buildUrl(credentials);
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
      ({ qoderKey, payload } = await buildQoderRequestBody({ model, body, credentials, log, proxyOptions, signal, region: this.region }));
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

    let cosyHeaders;
    try {
      cosyHeaders = buildCosyHeaders(
        encodedBodyBuf,
        url,
        {
          userId: psd.userId,
          authToken: credentials.accessToken,
          name: credentials.displayName || "",
          email: credentials.email || "",
          // PAT connections store no machine id. A random uuid per request
          // makes each call look like a brand-new device, and a new device
          // rejoins the back of the model queue. Derive a stable one instead.
          machineId: psd.machineCode || psd.machineId || deriveMachineId(psd.userId),
          machineToken: psd.machineToken || "",
          machineType: psd.machineType || "",
        },
      );
    } catch (err) {
      // cosy.js throws synchronously on missing userId/authToken — surface
      // as 401 so chatCore prompts re-auth instead of returning a 500.
      const fakeResp = new Response(
        JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    const modelSource = (payload.model_config && payload.model_config.source) || "system";
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": qoderKey,
      "X-Model-Source": modelSource,
      // gzip triggers signature validation on Qoder's CDN; force identity.
      "Accept-Encoding": "identity",
      ...cosyHeaders,
    };

    const label = `${this.provider}/${qoderKey}`;

    /**
     * One signed attempt. COSY signs the body, so every replay needs a fresh
     * signature — reusing one reuses its requestId and upstream answers
     * 403/code 103.
     */
    const sendOnce = async (attemptPayload) => {
      const attemptPlain = Buffer.from(JSON.stringify(attemptPayload), "utf8");
      const attemptEncoded = Buffer.from(qoderEncodeBody(attemptPlain), "latin1");

      let attemptHeaders;
      try {
        attemptHeaders = buildCosyHeaders(attemptEncoded, url, {
          userId: psd.userId,
          authToken: credentials.accessToken,
          name: credentials.displayName || "",
          email: credentials.email || "",
          machineId: psd.machineCode || psd.machineId || deriveMachineId(psd.userId),
          machineToken: psd.machineToken || "",
          machineType: psd.machineType || "",
        });
      } catch (err) {
        const fakeResp = new Response(
          JSON.stringify({ error: { message: `qoder cosy signing failed: ${err.message}` } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
        return { error: fakeResp, url, headers: {}, transformedBody: body };
      }

      const attemptHeadersFull = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Model-Key": qoderKey,
        "X-Model-Source": (attemptPayload.model_config && attemptPayload.model_config.source) || "system",
        // gzip triggers signature validation on Qoder's CDN; force identity.
        "Accept-Encoding": "identity",
        ...attemptHeaders,
      };

      // Abort if upstream doesn't return response headers within connect timeout.
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      let response;
      try {
        response = await proxyAwareFetch(
          url,
          { method: "POST", headers: attemptHeadersFull, body: attemptEncoded, signal: mergedSignal },
          // A failed proxy request may already have reached Qoder. Replaying
          // the same COSY signature directly reuses its requestId and returns
          // 403/code 103. Let the caller retry through execute() with fresh signing.
          { ...proxyOptions, strictProxy: true },
        );
      } catch (err) {
        // strictProxy wraps transport errors; retain caller cancellation semantics.
        if (mergedSignal.aborted) throw mergedSignal.reason;
        throw err;
      } finally {
        clearTimeout(connectTimer);
      }
      return { response, url, headers: attemptHeadersFull, transformedBody: attemptPayload };
    };

    /**
     * Poll the model-queue status endpoint qodercli uses. Returns
     * `{ endpointOk, info }`; endpointOk=false means "fall back to timed
     * replays" (endpoint missing, erroring, or answering an unknown shape).
     */
    const fetchQueueStatus = async (modelKey, queueType, requestSetId, requestId, sessionId) => {
      const statusUrl = qoderQueueStatusUrl(qoderInferenceBase(credentials, this.region), {
        requestSetId,
        modelKey,
        queueType,
      });
      try {
        const statusResponse = await proxyAwareFetch(
          statusUrl,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "identity",
              // qodercli correlates the poll with the original inference.
              "X-Request-ID": requestId,
              "X-Session-ID": sessionId || "",
              ...buildCosyHeaders(Buffer.alloc(0), statusUrl, {
                userId: psd.userId,
                authToken: credentials.accessToken,
                name: credentials.displayName || "",
                email: credentials.email || "",
                machineId: psd.machineCode || psd.machineId || deriveMachineId(psd.userId),
                machineToken: psd.machineToken || "",
                machineType: psd.machineType || "",
              }),
            },
            signal,
          },
          proxyOptions,
        );
        if (!statusResponse.ok) return { endpointOk: false, info: null };
        const info = parseQoderQueueStatus(await statusResponse.text().catch(() => ""));
        return info ? { endpointOk: true, info } : { endpointOk: false, info: null };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { endpointOk: false, info: null };
      }
    };

    // While a model is out of capacity the inference endpoint answers
    // 10605/isQueued instead of a completion. qodercli does not treat that as
    // fatal and does not replay blindly: it polls the queue-status endpoint
    // (keyed by the request set id) and replays only once that reports
    // isQueued:false, honouring the server's retryAfterSeconds. The poll is a
    // cheap GET that does not consume a queue slot.
    const maxQueueWaitMs = qoderQueueMaxWaitMs();
    const waitStartedAt = Date.now();
    let lastQueueInfo = null;
    let statusPollsEnabled = true;
    // Guards the "status says ready" fast path: one free replay, then stop
    // believing an endpoint that has already been contradicted.
    let readyReplayUsed = false;
    // The queue is keyed by request_set_id, and qodercli keeps ONE request_id
    // for the whole recovery. A fresh id per replay makes the status poll look
    // at a queue entry nobody is waiting on, so it reports queued forever.
    let attemptPayload = payload;

    for (;;) {
      const sent = await sendOnce(attemptPayload);
      if (sent.error) return { response: sent.error, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      if (!sent.response.ok) {
        // Pass error response through unchanged so chatCore can capture it.
        return { response: sent.response, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      // Peek the first frame without consuming the stream: a queued model
      // announces itself there, and wrapQoderSSE would read the body to
      // completion — which loses the ability to hand the same response back
      // when it turns out to be a normal completion.
      const reader = sent.response.body.getReader();
      const decoder = new TextDecoder();
      const peek = await peekFirstQoderFrame(reader, decoder);

      const queueInfo = peek.isError
        ? parseQoderQueueInfo(peek.message || "")
        : null;

      if (!queueInfo) {
        // Not a queue signal. A first-frame error is a genuine failure (billing
        // block, upstream error) — surface it so chatCore can fall back. A
        // successful peek means we consumed the head of a real completion, so
        // replay to get an intact stream.
        if (peek.isError) {
          const status = peek.isBilling ? HTTP_STATUS.FORBIDDEN
            : Number.isInteger(peek.statusVal) && peek.statusVal >= 400 && peek.statusVal <= 599
              ? peek.statusVal : HTTP_STATUS.BAD_GATEWAY;
          return {
            response: new Response(
              JSON.stringify({ error: { message: peek.message || "qoder upstream error", code: peek.statusVal } }),
              { status, headers: { "Content-Type": "application/json" } },
            ),
            url: sent.url,
            headers: sent.headers,
            transformedBody: sent.transformedBody,
          };
        }
        // Clean stream. The peek consumed the head, so hand the already-read
        // bytes back instead of re-sending — one upstream call per attempt.
        const reconstructed = new Response(
          new ReadableStream({
            start(controller) {
              // The consumer may close or cancel before we finish pumping (it
              // stops at the terminal frame), so every controller call has to
              // be guarded — close() twice throws ERR_INVALID_STATE.
              let closed = false;
              const finish = () => {
                if (closed) return;
                closed = true;
                try { controller.close(); } catch { /* already closed */ }
              };
              const push = (chunk) => {
                if (closed) return false;
                try {
                  controller.enqueue(chunk);
                  return true;
                } catch {
                  closed = true;
                  return false;
                }
              };

              const enc = new TextEncoder();
              if (peek.consumed && !push(enc.encode(peek.consumed))) return;
              if (peek.upstreamDone) {
                finish();
                return;
              }
              // Forward the remainder untouched.
              const pump = () => {
                if (closed) return;
                reader.read().then(({ done, value }) => {
                  if (done) { finish(); return; }
                  if (!push(value)) return;
                  pump();
                }).catch(() => finish());
              };
              pump();
            },
            cancel() {
              return reader.cancel().catch(() => {});
            },
          }),
          { status: sent.response.status, statusText: sent.response.statusText, headers: sent.response.headers },
        );
        const wrapped = await wrapQoderSSE(reconstructed, label, log);
        const recovered = recoverQoderToolCallStream(wrapped, label, body.tools);
        return { response: recovered, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      lastQueueInfo = queueInfo;
      const waitedMs = Date.now() - waitStartedAt;
      if (waitedMs >= maxQueueWaitMs) {
        log?.warn?.(
          "QODER",
          `model queue wait timed out after ${Math.round(waitedMs / 1000)}s for ${label} ` +
            `(queueType=${lastQueueInfo.queueType || "?"}, waitTime=${lastQueueInfo.waitTime ?? "?"}s)`,
        );
        const budgetResp = new Response(
          JSON.stringify({
            error: {
              message: `qoder model "${qoderKey}" is still queued after ${Math.round(waitedMs / 1000)}s ` +
                `(queueType=${lastQueueInfo.queueType || "?"}); retry shortly`,
              code: "qoder_model_queued",
              type: "rate_limit_error",
            },
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
        return { response: budgetResp, url: sent.url, headers: sent.headers, transformedBody: sent.transformedBody };
      }

      let delayMs = computeQoderQueueDelayMs(queueInfo);

      if (statusPollsEnabled) {
        const requestSetId = attemptPayload.request_set_id;
        const polled = await fetchQueueStatus(
          queueInfo.modelKey || qoderKey,
          queueInfo.queueType,
          requestSetId,
          attemptPayload.request_id,
          attemptPayload.session_id,
        );
        if (!polled.endpointOk) {
          // No usable status endpoint — keep the old timed-replay behaviour.
          statusPollsEnabled = false;
        } else if (polled.info.isQueued === false) {
          // The status endpoint says ready, but it has been observed saying that
          // while the inference call is still refused. Replay once, and if that
          // is refused too, stop trusting the endpoint and fall back to timed
          // replays — otherwise we spin on a hint that will never be true.
          if (readyReplayUsed) {
            statusPollsEnabled = false;
            log?.info?.(
              "QODER",
              `queue status claims ready but "${qoderKey}" is still refused; falling back to timed replays`,
            );
          } else {
            readyReplayUsed = true;
            log?.info?.(
              "QODER",
              `model "${qoderKey}" reported ready (queueType=${polled.info.queueType || "?"}); replaying`,
            );
            delayMs = 0;
          }
        } else {
          delayMs = computeQoderQueueDelayMs(polled.info, { fromStatus: true });
          log?.info?.(
            "QODER",
            `model "${qoderKey}" still queued (queueType=${polled.info.queueType || "?"}, ` +
              `queueCount=${polled.info.queueCount ?? "?"}); rechecking in ${Math.round(delayMs / 1000)}s`,
          );
        }
      }

      if (delayMs > 0) await sleep(delayMs, signal);
    }
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
  isBillingBlock,
};
