import { describe, expect, it } from "vitest";
import { normalizeStdioArgs } from "../../src/lib/chat/mcpArgsHelper.js";
import { listTools } from "../../src/lib/chat/mcpClient.js";
import m002 from "../../src/lib/db/migrations/002-mcp-browser-use-python.js";

describe("normalizeStdioArgs", () => {
  it("prepends --python 3.12 for uvx browser-use command without python flag", () => {
    const input = ["--with", "browser-use==0.1.43", "mcp-browser-use"];
    const output = normalizeStdioArgs("uvx", input);
    expect(output).toEqual(["--python", "3.12", "--with", "browser-use==0.1.43", "mcp-browser-use"]);
  });

  it("does not duplicate --python if already specified in uvx", () => {
    const input = ["--python", "3.11", "--with", "browser-use==0.1.43", "mcp-browser-use"];
    const output = normalizeStdioArgs("uvx", input);
    expect(output).toEqual(["--python", "3.11", "--with", "browser-use==0.1.43", "mcp-browser-use"]);
  });

  it("does not duplicate -p if already specified in uvx", () => {
    const input = ["-p", "3.12", "--with", "browser-use==0.1.43", "mcp-browser-use"];
    const output = normalizeStdioArgs("uvx", input);
    expect(output).toEqual(["-p", "3.12", "--with", "browser-use==0.1.43", "mcp-browser-use"]);
  });

  it("inserts --python 3.12 after run for uv run command", () => {
    const input = ["run", "--with", "browser-use==0.1.43", "mcp-browser-use"];
    const output = normalizeStdioArgs("uv", input);
    expect(output).toEqual(["run", "--python", "3.12", "--with", "browser-use==0.1.43", "mcp-browser-use"]);
  });

  it("leaves non-browser-use commands unchanged", () => {
    const input = ["-y", "@upstash/context7-mcp@1"];
    expect(normalizeStdioArgs("npx", input)).toEqual(input);
    expect(normalizeStdioArgs("uvx", ["some-other-tool"])).toEqual(["some-other-tool"]);
  });

  it("safely handles empty or non-array inputs", () => {
    expect(normalizeStdioArgs("uvx", null)).toEqual([]);
    expect(normalizeStdioArgs("uvx", undefined)).toEqual([]);
    expect(normalizeStdioArgs("uvx", [])).toEqual([]);
  });
});

describe("Migration 002: mcp-browser-use-python", () => {
  it("updates existing database rows that use uvx or uv with browser-use", () => {
    const dbState = [
      { id: "1", command: "uvx", args: JSON.stringify(["--with", "browser-use==0.1.43", "mcp-browser-use"]) },
      { id: "2", command: "npx", args: JSON.stringify(["-y", "@upstash/context7-mcp@1"]) },
      { id: "3", command: "uvx", args: JSON.stringify(["--python", "3.11", "--with", "browser-use==0.1.43", "mcp-browser-use"]) },
    ];
    const updates = [];
    const mockDb = {
      all(sql) {
        if (sql.includes("chatMcpServers")) return dbState;
        return [];
      },
      run(sql, params) {
        updates.push({ sql, params });
      },
    };

    m002.up(mockDb);

    expect(updates.length).toBe(1);
    expect(updates[0].params[1]).toBe("1");
    expect(JSON.parse(updates[0].params[0])).toEqual([
      "--python",
      "3.12",
      "--with",
      "browser-use==0.1.43",
      "mcp-browser-use",
    ]);
  });
});

describe("mcpClient integration with normalized browser-use args", () => {
  it("listTools succeeds without throwing MSVC compiler error", async () => {
    const server = {
      transport: "stdio",
      command: "uvx",
      args: ["--with", "browser-use==0.1.43", "mcp-browser-use"],
    };
    const tools = await listTools(server);
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("initialize_browser");
    expect(toolNames).toContain("search_google");
  }, 30000);
});
