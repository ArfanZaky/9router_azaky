import { describe, expect, it } from "vitest";
import { buildAgentReachArgs } from "../../src/lib/agent/agentReach.js";
import { getOpenAiTools } from "../../src/lib/agent/tools.js";

describe("Agent Reach chat tool", () => {
  it("offers only under Full access", () => {
    expect(getOpenAiTools("sandbox").some((tool) => tool.function.name === "agent_reach")).toBe(false);
    expect(getOpenAiTools("full").some((tool) => tool.function.name === "agent_reach")).toBe(true);
  });

  it("builds fixed search argv without shell interpretation", () => {
    expect(buildAgentReachArgs({ action: "search", query: "x; rm -rf /" })).toEqual([
      "web", "search", "x; rm -rf /", "--limit", "5", "--backend", "exa", "--timeout", "25",
    ]);
  });

  it("matches Agent Reach public-read policy and CLI argv", () => {
    expect(buildAgentReachArgs({ action: "read", url: "https://example.com/page" })).toEqual([
      "read", "https://example.com/page", "--backend", "jina", "--timeout", "25",
    ]);
    for (const url of [
      "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/",
      "http://100.64.0.1/", "http://192.168.1.1/", "http://169.254.169.254/",
      "http://[fc00::1]/", "http://[fe80::1]/", "http://localhost/",
      "http://host.local/", "http://foo\\bar/", "http://example.com/path with spaces",
    ]) {
      expect(() => buildAgentReachArgs({ action: "read", url })).toThrow("public HTTP URL");
    }
  });

  it("rejects unapproved actions, oversize input, and URL credentials", () => {
    expect(() => buildAgentReachArgs({ action: "login", query: "x" })).toThrow("action must be search or read");
    expect(() => buildAgentReachArgs({ action: "search", query: "x".repeat(501) })).toThrow("maximum 500");
    expect(() => buildAgentReachArgs({ action: "read", url: "https://user:pass@example.com" })).toThrow("public HTTP URL");
    expect(() => buildAgentReachArgs({ action: "read", url: "http://127.0.0.1/admin" })).toThrow("public HTTP URL");
    expect(() => buildAgentReachArgs({ action: "read", url: "http://[::1]/admin" })).toThrow("public HTTP URL");
  });
});
