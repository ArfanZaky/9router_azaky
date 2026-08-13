/**
 * Unit tests for Qoder encoding + COSY signing primitives.
 *
 * These cover the parts that would silently produce wrong-but-plausible
 * output if logic regressed:
 *   - body encoder boundary cases (empty input, lengths not divisible by 3)
 *   - COSY header production (signature deterministic given fixed inputs,
 *     all required headers present, sigPath correctly stripped)
 *   - device flow URL construction
 */

import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";

import { qoderEncodeBody } from "../../src/lib/qoder/encoding.js";
import { buildCosyHeaders } from "../../src/lib/qoder/cosy.js";
import { QoderService } from "../../src/lib/oauth/services/qoder.js";
import {
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_LIST_URL,
  QODER_MODEL_MAP,
} from "../../src/lib/qoder/constants.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import qoderProvider from "../../open-sse/providers/registry/qoder.js";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

// Convenience aliases — tests were originally written against module-level
// helpers; the QoderService class wraps them so each test creates its own
// instance to avoid hidden state.
const generatePkcePair = () => new QoderService().generatePkcePair();
const initiateDeviceFlow = () => new QoderService().initiateDeviceFlow();
const parseExpiry = QoderService.parseExpiry;

describe("QODER_MODEL_MAP", () => {
  it("allows Qoder's latest model key", () => {
    expect(QODER_MODEL_MAP.qmodel_latest).toBe("qmodel_latest");
  });

  it("exposes Qoder's latest model in the static provider catalog", () => {
    expect(PROVIDER_MODELS.qd.some((model) => model.id === "qmodel_latest")).toBe(true);
  });
});

describe("qoderEncodeBody", () => {
  it("preserves base64 length (input length divisible by 3)", () => {
    const input = Buffer.from("abcdef", "utf8"); // 6 bytes → 8 base64 chars
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("preserves base64 length (input length not divisible by 3)", () => {
    const input = Buffer.from("hello", "utf8"); // 5 bytes → 8 base64 chars (with padding)
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("handles empty input without throwing", () => {
    const encoded = qoderEncodeBody(Buffer.alloc(0));
    expect(encoded).toBe("");
  });

  it("accepts string and Buffer inputs equivalently", () => {
    const a = qoderEncodeBody("hello");
    const b = qoderEncodeBody(Buffer.from("hello", "utf8"));
    expect(a).toBe(b);
  });

  it("only emits characters from the custom alphabet", () => {
    // The custom alphabet is "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"
    // plus "$" for the padding char. If the substitution step regresses,
    // characters outside that set would leak into the output.
    const allowed = new Set(
      "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$",
    );
    const encoded = qoderEncodeBody(
      "hello world this is a longer string for testing 0123456789",
    );
    for (const ch of encoded) {
      expect(allowed.has(ch), `unexpected char in output: ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("abc");
    expect(a).toBe(b);
  });

  it("produces different output for different input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("xyz");
    expect(a).not.toBe(b);
  });
});

describe("generatePkcePair", () => {
  it("produces base64url-safe verifier and challenge of the right length", () => {
    const { verifier, challenge } = generatePkcePair();
    // 32 bytes → 43 base64url chars (no padding)
    expect(verifier.length).toBe(43);
    expect(challenge.length).toBe(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifier and challenge are different (challenge is sha256 of verifier)", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).not.toBe(challenge);
    // S256: challenge should be base64url(sha256(verifier))
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(challenge).toBe(expected);
  });

  it("returns codeVerifier (not verifier) on the higher-level helper", () => {
    // Regression: the providers.js qoder entry once read flow.verifier (undefined)
    // because initiateDeviceFlow returns the field as `codeVerifier`.
    const flow = initiateDeviceFlow();
    expect(typeof flow.codeVerifier).toBe("string");
    expect(flow.codeVerifier.length).toBe(43);
    expect(flow.verifier).toBeUndefined();
  });
});

describe("initiateDeviceFlow", () => {
  it("produces a verification URL pointing at qoder.com/device/selectAccounts", () => {
    const flow = initiateDeviceFlow();
    expect(flow.verificationUriComplete).toMatch(
      /^https:\/\/qoder\.com\/device\/selectAccounts\?/,
    );
    expect(flow.verificationUriComplete).toContain("challenge_method=S256");
    expect(flow.verificationUriComplete).toContain(`nonce=${flow.nonce}`);
    expect(flow.verificationUriComplete).toContain(`machine_id=${flow.machineId}`);
  });

  it("returns nonce and machineId as UUIDs", () => {
    const flow = initiateDeviceFlow();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(flow.nonce).toMatch(uuidRe);
    expect(flow.machineId).toMatch(uuidRe);
  });
});

describe("Qoder PAT import helpers", () => {
  const service = new QoderService();

  it("parses a complete PAT and preserves machine identity", () => {
    expect(service.parsePatEntry("pt-test:machine-token:0:machine-code")).toEqual({
      personalToken: "pt-test",
      machineToken: "machine-token",
      machineType: "0",
      machineCode: "machine-code",
      machineId: "machine-code",
    });
  });

  it("generates and reuses one machine identity for a minimal PAT", () => {
    const parsed = service.parsePatEntry("pt-test");
    expect(parsed.machineCode).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.machineId).toBe(parsed.machineCode);
    expect(parsed.machineToken).toBe(parsed.machineCode);
    expect(parsed.machineType).toBe("0");
  });

  it("rejects malformed PAT entries", () => {
    expect(() => service.parsePatEntry("not-a-pat")).toThrow(/Invalid Qoder PAT/);
    expect(() => service.parsePatEntry("pt-a:b:0:c:extra")).toThrow(/Invalid Qoder PAT/);
  });
});

describe("buildCosyHeaders", () => {
  const creds = {
    userId: "test-user-id",
    authToken: "dt-test-token",
    name: "Test",
    email: "test@example.com",
    machineId: "fixed-machine-id",
  };

  it("produces all required Cosy-* headers", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    const required = [
      "Authorization",
      "Cosy-Key",
      "Cosy-User",
      "Cosy-Date",
      "Cosy-Version",
      "Cosy-Machineid",
      "Cosy-Machinetoken",
      "Cosy-Machinetype",
      "Cosy-Machineos",
      "Cosy-Clienttype",
      "Cosy-Clientip",
      "Cosy-Bodyhash",
      "Cosy-Bodylength",
      "Cosy-Sigpath",
      "Cosy-Data-Policy",
      "Login-Version",
      "X-Request-Id",
    ];
    for (const key of required) {
      expect(headers[key], `missing header ${key}`).toBeDefined();
    }
  });

  it("Authorization is a Bearer COSY token with payload+sig", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[a-f0-9]{32}$/);
  });

  it("Cosy-Sigpath strips the leading /algo prefix", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Sigpath"]).toBe("/api/v2/model/list");
  });

  it("Cosy-Sigpath also handles the encoded chat URL", () => {
    const headers = buildCosyHeaders(Buffer.from("body", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(headers["Cosy-Sigpath"]).toBe(
      "/api/v2/service/pro/sse/agent_chat_generation",
    );
  });

  it("Cosy-Bodyhash is the MD5 of the request body, Cosy-Bodylength is the length", () => {
    const body = Buffer.from("hello qoder", "utf8");
    const headers = buildCosyHeaders(body, QODER_MODEL_LIST_URL, creds);
    const expectedHash = crypto.createHash("md5").update(body).digest("hex");
    expect(headers["Cosy-Bodyhash"]).toBe(expectedHash);
    expect(headers["Cosy-Bodylength"]).toBe(String(body.length));
  });

  it("empty body produces the canonical empty-MD5 hash", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Bodyhash"]).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(headers["Cosy-Bodylength"]).toBe("0");
  });

  it("Cosy-Machineid + Cosy-Machinetoken match the supplied machineId", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Machineid"]).toBe("fixed-machine-id");
    expect(headers["Cosy-Machinetoken"]).toBe("fixed-machine-id");
  });

  it("preserves explicit PAT machine token and type", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, {
      ...creds,
      machineToken: "pat-machine-token",
      machineType: "0",
    });
    expect(headers["Cosy-Machinetoken"]).toBe("pat-machine-token");
    expect(headers["Cosy-Machinetype"]).toBe("0");
  });

  it("auto-generates a machineId when none is supplied", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, {
      ...creds,
      machineId: "",
    });
    expect(headers["Cosy-Machineid"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("throws when userId is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, userId: "" }),
    ).toThrow(/user id is empty/);
  });

  it("throws when authToken is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, authToken: "" }),
    ).toThrow(/auth token is empty/);
  });

  it("Cosy-User reflects the supplied userId verbatim", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-User"]).toBe("test-user-id");
  });

  it("two calls with identical inputs differ only in fields that include fresh randomness", () => {
    // The signature fingerprints a fresh AES key + UUID per call, so the
    // signature, Cosy-Key, X-Request-Id, and Cosy-Date (1s resolution)
    // can differ — but Cosy-User, Cosy-Bodyhash, Cosy-Bodylength,
    // Cosy-Sigpath, and the machineId-derived headers must be stable.
    const a = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    const b = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(a["Cosy-User"]).toBe(b["Cosy-User"]);
    expect(a["Cosy-Bodyhash"]).toBe(b["Cosy-Bodyhash"]);
    expect(a["Cosy-Bodylength"]).toBe(b["Cosy-Bodylength"]);
    expect(a["Cosy-Sigpath"]).toBe(b["Cosy-Sigpath"]);
    expect(a["Cosy-Machineid"]).toBe(b["Cosy-Machineid"]);
    expect(a["X-Request-Id"]).not.toBe(b["X-Request-Id"]);
  });
});

describe("parseExpiry", () => {
  // Regression for review finding #2: numeric expires_at was silently
  // dropped because the function only inspected strings.
  it("accepts ms-epoch as a JSON number", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(future, undefined)).toBe(future);
  });

  it("accepts ms-epoch as a numeric string", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(String(future), undefined)).toBe(future);
  });

  it("accepts RFC3339 strings", () => {
    const iso = "2030-01-02T03:04:05Z";
    expect(parseExpiry(iso, undefined)).toBe(Date.parse(iso));
  });

  // Regression for review finding #5: Date.parse("2026") returns Jan 1 2026,
  // so a short numeric string like "2026" used to be interpreted as a year
  // instead of falling through to the integer-ms branch. We now try the
  // pure-numeric path first so this can't happen again.
  it("does not interpret short numeric strings as a year", () => {
    // "1700000000" (Unix seconds) should NOT come out as Date.parse("1700000000")
    const result = parseExpiry("1700000000", undefined);
    // 1.7e9 ms = 1970-01-20 — the function's contract is ms, so we expect
    // exactly that value, not a year interpretation.
    expect(result).toBe(1_700_000_000);
  });

  it("falls back to expiresInSeconds when expiresAt is missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 60);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 60_000);
    expect(result).toBeLessThanOrEqual(after + 60_000);
  });

  // Regression for review finding #7: expiresInSeconds=0 used to be treated
  // as missing and silently fabricated 30-day default. We now honor 0 as
  // "already expired".
  it("treats expires_in: 0 as already expired (now), not 30-day fallback", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 0);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("falls back to ~30 days when both inputs are missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, undefined);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    // Allow a small skew to absorb test runtime.
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });

  it("falls back to ~30 days when both inputs are unparseable", () => {
    const before = Date.now();
    const result = parseExpiry("not-a-date", -5);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });
});

describe("normalizeMessages", () => {
  const { normalizeMessages } = qoderExecutorInternals;

  it("hoists role:system out of messages into systemText", () => {
    const result = normalizeMessages([
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("you are helpful");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("flattens multipart text content into a string", () => {
    const result = normalizeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ]);
    expect(result.messages[0].content).toBe("part1\npart2");
  });

  it("joins multiple system messages with a blank line", () => {
    const result = normalizeMessages([
      { role: "system", content: "rule 1" },
      { role: "system", content: "rule 2" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("rule 1\n\nrule 2");
  });

  it("returns empty results for empty input", () => {
    const result = normalizeMessages([]);
    expect(result.messages).toEqual([]);
    expect(result.systemText).toBe("");
  });

  it("flattens assistant tool calls and tool results into supported roles", () => {
    const result = normalizeMessages([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: '{"path":"a"}' } }] },
      { role: "tool", tool_call_id: "call-1", content: "file body" },
    ]);
    expect(result.messages.map((message) => message.role)).toEqual(["assistant", "user"]);
    expect(result.messages[0].content).toContain("[assistant requested tools]");
    expect(result.messages[0].content).toContain('read_file({"path":"a"})');
    expect(result.messages[1].content).toBe("[tool result call-1]\nfile body");
    expect(result.messages[1].contents[0].text).toBe(result.messages[1].content);
  });

  it("hoists developer messages and normalizes function messages", () => {
    const result = normalizeMessages([
      { role: "developer", content: "developer rule" },
      { role: "function", content: "function result" },
    ]);
    expect(result.systemText).toBe("developer rule");
    expect(result.messages[0].role).toBe("assistant");
  });
});

describe("compactMessages", () => {
  const { compactMessages } = qoderExecutorInternals;
  const message = (text) => ({ role: "user", content: text, contents: [{ type: "text", text }] });

  it("preserves histories within the model-aware budget", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(`message ${index}`));
    expect(compactMessages(messages, 180000)).toBe(messages);
  });

  it("removes oldest messages and inserts a marker when over budget", () => {
    const newest = message("newest");
    const result = compactMessages([message("a".repeat(190000)), newest], 1);
    expect(result[0].content).toContain("earlier context compacted");
    expect(result.at(-1)).toBe(newest);
  });
});

describe("inspectFirstQoderEvent", () => {
  const { inspectFirstQoderEvent } = qoderExecutorInternals;

  function responseFor(envelope) {
    return new Response(`data: ${JSON.stringify(envelope)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  it("promotes embedded Qoder quota errors", async () => {
    const result = await inspectFirstQoderEvent(responseFor({ statusCodeValue: 403, body: '{"code":"112","message":"pricingUrl"}' }));
    expect(result.quota).toBe(true);
  });

  it("identifies embedded 504 responses for retry", async () => {
    const result = await inspectFirstQoderEvent(responseFor({ statusCodeValue: 504, body: "gateway timeout" }));
    expect(result.retry504).toBe(true);
  });

  it("replays a successful first event exactly once", async () => {
    const response = responseFor({ statusCodeValue: 200, body: "chunk" });
    const result = await inspectFirstQoderEvent(response);
    const text = await result.response.text();
    expect((text.match(/statusCodeValue/g) || []).length).toBe(1);
  });
});

describe("Qoder flattened response tool recovery", () => {
  const { recoverFlattenedToolCalls, recoverQoderToolCallStream } = qoderExecutorInternals;

  it("recovers an unbracketed edit call with escaped multiline content", () => {
    const args = {
      filePath: "F:\\project\\app\\myprofile.tsx",
      oldString: "const submit = async () => {",
      newString: "const submit = async () => {\n\tif (!image) return;",
    };
    const recovered = recoverFlattenedToolCalls(
      `Updating frontend.\nassistant requested tools\nedit(${JSON.stringify(args)})`,
      new Set(["edit"]),
    );
    expect(recovered.content).toBe("Updating frontend.");
    expect(recovered.toolCalls).toHaveLength(1);
    expect(recovered.toolCalls[0].function.name).toBe("edit");
    expect(JSON.parse(recovered.toolCalls[0].function.arguments)).toEqual(args);
  });

  it("converts flattened content into standard OpenAI streaming tool calls", async () => {
    const source = [
      { choices: [{ delta: { content: "assistant requested tools\n" }, finish_reason: null }] },
      { choices: [{ delta: { content: 'grep({"pattern":"story","path":"src"})\n' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'glob({"pattern":"pages/**/*.tsx","path":"src"})' }, finish_reason: "stop" }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const response = recoverQoderToolCallStream(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      "qoder/qmodel_latest",
      [{ type: "function", function: { name: "grep" } }, { type: "function", function: { name: "glob" } }],
    );
    const output = await response.text();
    expect(output).toContain('"name":"grep"');
    expect(output).toContain('"name":"glob"');
    expect(output).toContain('"finish_reason":"tool_calls"');
    expect(output).not.toContain("assistant requested tools");
  });

  it("leaves unknown flattened tools as ordinary content", async () => {
    const source = `data: ${JSON.stringify({ choices: [{ delta: { content: 'assistant requested tools\nunknown({"x":1})' }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    const response = recoverQoderToolCallStream(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      "qoder/qmodel_latest",
      [{ type: "function", function: { name: "edit" } }],
    );
    const output = await response.text();
    expect(output).toContain("assistant requested tools");
    expect(output).toContain("unknown");
    expect(output).not.toContain('"tool_calls"');
    expect(output).toContain("data: [DONE]");
  });

  // Regression: qoder emits the flattened tool block AND finish_reason:"stop"
  // together in one final chunk. The old finish-first ordering forwarded the
  // raw "[assistant requested tools]" text as content, so opencode treated the
  // tool request as the final answer and stopped (user-reported "suka putus",
  // "assistant requested tools" leaking into the answer).
  it("recovers flattened tool calls bundled with finish_reason stop in a single chunk", async () => {
    const args = { path: "F:\\project\\php\\konimex\\stock\\app\\Models\\Product.php" };
    const content = `[assistant requested tools]\nread_file(${JSON.stringify(args)})`;
    const source = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    const response = recoverQoderToolCallStream(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      "qoder/qmodel_latest",
      [{ type: "function", function: { name: "read_file" } }],
    );
    const output = await response.text();
    const events = output
      .split("\n\n")
      .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice("data: ".length)));
    const toolChunk = events.find((e) => e.choices?.[0]?.delta?.tool_calls);
    expect(toolChunk).toBeDefined();
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("read_file");
    expect(JSON.parse(toolChunk.choices[0].delta.tool_calls[0].function.arguments)).toEqual(args);
    expect(output).toContain('"finish_reason":"tool_calls"');
    expect(output).not.toContain("[assistant requested tools]");
    // Exactly one non-null terminal signal reaches the client (the tool_calls
    // chunk also carries "finish_reason":null, which is harmless).
    expect((output.match(/"finish_reason":"tool_calls"/g) || []).length).toBe(1);
    expect(output).not.toContain('"finish_reason":"stop"');
    expect((output.match(/data: \[DONE\]/g) || []).length).toBe(1);
  });

  // Regression: marker text split across multiple deltas with the terminal
  // finish_reason arriving later — recovery must still work and the terminal
  // must not be dropped.
  it("recovers flattened tool calls across multiple deltas before finish_reason", async () => {
    const source = [
      { choices: [{ delta: { content: "assistant requested tools\n" }, finish_reason: null }] },
      { choices: [{ delta: { content: 'edit({"filePath":"a.js","oldString":"x","newString":"y"})\n' }, finish_reason: null }] },
      { choices: [{ delta: { content: "" }, finish_reason: "stop" }] },
    ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    const response = recoverQoderToolCallStream(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      "qoder/qmodel_latest",
      [{ type: "function", function: { name: "edit" } }],
    );
    const output = await response.text();
    expect(output).toContain('"name":"edit"');
    expect(output).toContain('"finish_reason":"tool_calls"');
    expect(output).not.toContain("assistant requested tools");
    expect((output.match(/data: \[DONE\]/g) || []).length).toBe(1);
  });
});

describe("Qoder transport", () => {
  it("uses five-minute connect and stall timeouts", () => {
    expect(qoderProvider.transport.timeoutMs).toBe(300000);
    expect(qoderProvider.transport.stallTimeoutMs).toBe(300000);
  });
});

describe("wrapQoderSSE", () => {
  const { wrapQoderSSE } = qoderExecutorInternals;

  // Helper: build a fake Response carrying the given lines as the body.
  function makeResponse(lines, { status = 200 } = {}) {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { status });
  }

  // Helper: drain a wrapped response into an array of decoded SSE events.
  async function drain(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  }

  it("forwards an OpenAI envelope chunk and emits [DONE] in flush", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}\n\n`;
    const wrapped = wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
    expect(out).toContain("data: [DONE]\n\n");
  });

  // Regression for review finding #4: a final data: line without a trailing
  // newline used to be silently dropped from `buffer` in flush().
  it("drains a trailing partial line without a newline in flush()", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "tail" } }], finish_reason: "stop" });
    // Note: NO trailing \n on the final line.
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}`;
    const wrapped = wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
  });

  // Regression for review finding #3: chunks could leak past [DONE] when
  // the success branch had no doneEmitted guard. We synthesize an error
  // envelope (which sets doneEmitted=true) followed by a valid envelope
  // and assert the second envelope is NOT forwarded.
  it("does not forward chunks after [DONE] has been emitted", async () => {
    const errorEnv = JSON.stringify({ statusCodeValue: 500, body: "boom" });
    const validInner = JSON.stringify({ choices: [{ delta: { content: "leak" } }] });
    const validEnv = JSON.stringify({ statusCodeValue: 200, body: validInner });
    const wrapped = wrapQoderSSE(
      makeResponse([`data: ${errorEnv}\n\ndata: ${validEnv}\n\n`]),
      "qoder/auto",
    );
    const out = await drain(wrapped);
    expect(out).not.toContain("leak");
    // Should still have a single [DONE].
    const doneCount = (out.match(/data: \[DONE\]/g) || []).length;
    expect(doneCount).toBe(1);
  });

  // Regression for review finding #6: literal newlines inside the inner
  // OpenAI body would split the SSE frame across multiple data: lines.
  // We now strip them so the frame stays a single event.
  it("strips embedded newlines from inner body before forwarding", async () => {
    const innerWithNewlines = '{"choices":[{"delta":{"content":"a\nb"}}]}';
    const env = JSON.stringify({ statusCodeValue: 200, body: innerWithNewlines });
    const wrapped = wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/auto");
    const out = await drain(wrapped);
    // The forwarded data: line should be a single event terminated by \n\n
    // and contain no internal \n other than the trailing pair.
    const dataLine = out.split("\n\n").find((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
    expect(dataLine).toBeDefined();
    // Body sans "data: " prefix should be valid JSON.
    expect(() => JSON.parse(dataLine.slice("data: ".length))).not.toThrow();
  });

  it("upstream error envelope produces an error chunk + [DONE]", async () => {
    const env = JSON.stringify({ statusCodeValue: 503, body: "service unavailable" });
    const wrapped = wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/lite");
    const out = await drain(wrapped);
    expect(out).toContain("[qoder error 503");
    expect(out).toContain("data: [DONE]\n\n");
  });

  it("non-ok responses are returned unchanged (no transform)", () => {
    const r = new Response("not ok", { status: 500 });
    const wrapped = wrapQoderSSE(r, "qoder/auto");
    expect(wrapped).toBe(r);
  });
});

describe("buildQoderRequestBody plan gate", () => {
  const { buildQoderRequestBody } = qoderExecutorInternals;

  function makeCredentials(planTier) {
    return {
      accessToken: "dt-test-token",
      email: "free@example.com",
      displayName: "Free User",
      providerSpecificData: {
        userId: "user-id-1",
        machineId: "machine-id-1",
        planTier,
      },
    };
  }

  it("rejects models with enable:false before building a payload", async () => {
    const modelsModule = await import("../../open-sse/services/qoderModels.js");
    const spy = vi.spyOn(modelsModule, "getQoderModelConfig").mockResolvedValue({
      key: "auto",
      enable: false,
      max_input_tokens: 180000,
    });

    let thrown;
    try {
      await buildQoderRequestBody({
        model: "qoder/auto",
        body: { messages: [{ role: "user", content: "hi" }] },
        credentials: makeCredentials("PLAN_TIER_FREE"),
        log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      });
    } catch (err) {
      thrown = err;
    } finally {
      spy.mockRestore();
    }
    expect(thrown).toBeDefined();
    expect(thrown.status).toBe(403);
    expect(thrown.code).toBe("model_not_enabled");
    expect(thrown.message).toContain("PLAN_TIER_FREE");
    expect(thrown.message).toContain("qmodel_latest");
  });

  it("accepts models with enable:true and produces a payload", async () => {
    const modelsModule = await import("../../open-sse/services/qoderModels.js");
    const spy = vi.spyOn(modelsModule, "getQoderModelConfig").mockResolvedValue({
      key: "qmodel_latest",
      enable: true,
      is_reasoning: false,
      max_input_tokens: 180000,
    });

    let result;
    try {
      result = await buildQoderRequestBody({
        model: "qoder/qmodel_latest",
        body: { messages: [{ role: "user", content: "hello world" }] },
        credentials: makeCredentials("PLAN_TIER_FREE"),
        log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      });
    } finally {
      spy.mockRestore();
    }
    expect(result.qoderKey).toBe("qmodel_latest");
    expect(result.payload.model_config.enable).toBe(true);
    expect(result.payload.messages).toHaveLength(1);
    expect(result.payload.messages[0].content).toBe("hello world");
  });
});

describe("qoder image extraction", () => {
  const { extractImages, extractText } = qoderExecutorInternals;

  it("extracts OpenAI image_url blocks", () => {
    const urls = extractImages([
      { type: "text", text: "describe this" },
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
      { type: "image_url", image_url: "data:image/png;base64,AAAA" },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://example.com/a.png");
    expect(urls[1]).toBe("data:image/png;base64,AAAA");
  });

  it("extracts Anthropic image source blocks", () => {
    const urls = extractImages([
      { type: "image", source: { type: "url", url: "https://example.com/b.png" } },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "Zm9v" } },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("https://example.com/b.png");
    expect(urls[1]).toBe("data:image/jpeg;base64,Zm9v");
  });

  it("ignores non-image blocks and returns empty", () => {
    expect(extractImages([{ type: "text", text: "hello" }])).toEqual([]);
    expect(extractImages("plain string")).toEqual([]);
    expect(extractImages(null)).toEqual([]);
  });

  it("normalizeMessages collects images into the images field", () => {
    const { normalizeMessages } = qoderExecutorInternals;
    const res = normalizeMessages([
      { role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image_url", image_url: { url: "https://example.com/x.png" } }] },
    ]);
    expect(res.images).toEqual(["https://example.com/x.png"]);
    expect(res.messages[0].content).toBe("what is this?");
    // images should not leak into text content
    expect(res.messages[0].content).not.toContain("https://example.com/x.png");
  });

  it("extractText drops image blocks but keeps text", () => {
    const text = extractText([
      { type: "text", text: "keep me" },
      { type: "image_url", image_url: { url: "https://example.com/x.png" } },
    ]);
    expect(text).toBe("keep me");
  });
});
