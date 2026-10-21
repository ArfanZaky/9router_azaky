import { describe, expect, it } from "vitest";
import { buildMcpToolRegistry, resolveMcpRegistryCall } from "../../src/lib/chat/mcpToolRegistry.js";
import { reflectionSkipReason } from "../../src/lib/chat/reflectionEligibility.js";
import { buildSkillCatalogue } from "../../src/lib/agent/skills.js";
import { listTools } from "../../src/lib/chat/mcpClient.js";

const tool = (name) => ({ name, inputSchema: { type: "object", properties: {} } });

describe("REA tool registration", () => {
  it("creates valid stable names and retains original dispatch identity", () => {
    const server = { id: "one", name: "REA (Reverse Engineer Anything)" };
    const long = "inspect_native_" + "x".repeat(75);
    const output = buildMcpToolRegistry([{ server, toolList: [tool("open_binary"), tool(long)] }]);
    expect(output.tools).toHaveLength(2);
    for (const item of output.tools) expect(item.function.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(output.registry.map((item) => item.toolName)).toEqual(["open_binary", long]);
    expect(output.tools[0].function.name).toBe("mcp__REA_Reverse_Engineer_Anything__open_binary");
  });

  it("disambiguates servers whose display names sanitize to the same slug", () => {
    const output = buildMcpToolRegistry([
      { server: { id: "1", name: "REA tools" }, toolList: [tool("open_binary")] },
      { server: { id: "2", name: "REA@tools" }, toolList: [tool("open_binary")] },
    ]);
    expect(new Set(output.tools.map((item) => item.function.name)).size).toBe(2);
  });

  it("loads only common REA schemas directly; discovers and dispatches all others", () => {
    const server = { id: "rea-id", name: "rea" };
    const inventory = [tool("open_binary"), tool("inspect_native_instruction"), ...Array.from({ length: 170 }, (_, n) => tool(`optional_tool_${n}`))];
    const { tools, registry } = buildMcpToolRegistry([{ server, toolList: inventory }]);
    expect(tools.map((item) => item.function.name)).toEqual([
      "mcp__rea__open_binary", "mcp__rea__discover_tools", "mcp__rea__call_tool",
    ]);
    expect(tools.every((item) => /^[a-zA-Z0-9_-]{1,64}$/.test(item.function.name))).toBe(true);
    const discover = registry.find((entry) => entry.virtual === "discover");
    expect(resolveMcpRegistryCall(discover, { query: "inspect_native_instruction" }).result.tools[0].name)
      .toBe("inspect_native_instruction");
    const list = resolveMcpRegistryCall(discover, { query: "optional_tool", offset: 10 }).result;
    expect(list.total).toBe(170);
    expect(list.tools).toHaveLength(5);
    expect(list.tools[0].name).toBe("optional_tool_10");
    const invoke = registry.find((entry) => entry.virtual === "call");
    expect(resolveMcpRegistryCall(invoke, { name: "inspect_native_instruction", arguments: { address: "0x1000" } }))
      .toEqual({ name: "inspect_native_instruction", arguments: { address: "0x1000" } });
    expect(resolveMcpRegistryCall(invoke, { name: "not-a-tool" }).result.ok).toBe(false);
    expect(resolveMcpRegistryCall(registry[0], { path: "file" })).toEqual({ name: "open_binary", arguments: { path: "file" } });
  });

  it("surfaces failed stdio servers rather than silently returning zero tools", async () => {
    await expect(listTools({ transport: "stdio", command: "nonexistent_9router_mcp_server_451", args: [] }))
      .rejects.toThrow(/MCP|not recognized|ENOENT|exited|timeout/i);
  }, 65000);
});

describe("Hermes self-improvement eligibility", () => {
  const ready = { mode: "agent", workspace: "/workspace", apiKey: "token", content: "Completed work" };
  it("reviews continuation turns when there may be durable new knowledge", () => {
    expect(reflectionSkipReason({ ...ready, userText: "lanjut" })).toBeNull();
    expect(reflectionSkipReason({ ...ready, userText: "continue" })).toBeNull();
  });
  it("reports genuine skips with specific reasons", () => {
    expect(reflectionSkipReason({ ...ready, userText: "ok" })).toBe("routine message");
    expect(reflectionSkipReason({ ...ready, mode: "plain", userText: "debug" })).toBe("agent mode is off");
    expect(reflectionSkipReason({ ...ready, userText: "debug", content: "" })).toBe("assistant response is empty");
  });
  it("keeps REA skill visible even when catalogue exceeds budget", () => {
    const skills = [
      { id: "a", name: "a", description: "x".repeat(200) },
      { id: "rea-reverse-engineer", name: "rea-reverse-engineer", description: "Use REA" },
    ];
    expect(buildSkillCatalogue(skills, 20)).toContain("rea-reverse-engineer");
  });
});
