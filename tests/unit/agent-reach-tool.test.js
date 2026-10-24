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

  it("rejects unapproved actions, oversize input, and URL credentials", () => {
    expect(() => buildAgentReachArgs({ action: "login", query: "x" })).toThrow("action must be search or read");
    expect(() => buildAgentReachArgs({ action: "search", query: "x".repeat(501) })).toThrow("maximum 500");
    expect(() => buildAgentReachArgs({ action: "read", url: "https://user:pass@example.com" })).toThrow("public HTTP URL");
    expect(() => buildAgentReachArgs({ action: "read", url: "http://127.0.0.1/admin" })).toThrow("public HTTP URL");
    expect(() => buildAgentReachArgs({ action: "read", url: "http://[::1]/admin" })).toThrow("public HTTP URL");
  });
});
