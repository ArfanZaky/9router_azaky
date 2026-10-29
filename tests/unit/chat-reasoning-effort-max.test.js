import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// /dashboard/chat offers a "Max" reasoning effort. Two things must hold:
//   1. the picker actually renders the option (source guard, no DOM harness here)
//   2. a DeepSeek v4.1 model keeps "max" on the wire instead of clamping to xhigh
const MODEL = "DeepSeek-V4.1-Flash-1017";

describe("chat reasoning effort: max level", () => {
  it("composer menu renders the Max option", () => {
    const src = fs.readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/chat/ChatPageClient.js", import.meta.url),
      "utf8"
    );
    expect(src).toContain('{ value: "max", label: "Max"');
  });

  it("DeepSeek v4.1 advertises max as a selectable level", () => {
    expect(getThinkingLevels("river", MODEL)).toContain("max");
  });

  it("max survives to the upstream body for a DeepSeek v4.1 model", () => {
    const out = applyThinking(FORMATS.OPENAI, MODEL, { reasoning_effort: "max" }, "river");
    expect(out.reasoning_effort).toBe("max");
    expect(out.thinking).toEqual({ type: "enabled" });
  });

  it("a model whose level set lacks max clamps to its highest advertised level", () => {
    // codebuddy-cn deepseek-v4-pro publishes low/high/xhigh and speaks openai
    // reasoning_effort, so normalizeOpenAILevel() lands on xhigh.
    const out = applyThinking(FORMATS.OPENAI, "deepseek-v4-pro", { reasoning_effort: "max" }, "codebuddy-cn");
    expect(out.reasoning_effort).toBe("xhigh");
  });
});
