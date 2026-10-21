import { createHash } from "node:crypto";

const OPENAI_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

// REA currently exposes ~170 tools (over 400 KB of JSON Schema). Sending all of
// them with EVERY chat turn exhausts small model contexts before any work starts.
// Keep the most useful entry points direct, and make the full inventory callable
// through the two bounded tools below. Other MCP servers are left unchanged.
const REA_DIRECT_TOOLS = new Set([
  "binary_session", "open_binary", "close_binary", "binary_overview",
  "inspect_artifact", "inspect_binary_layout", "analyze_function",
  "search_procedures", "search_strings", "analyze_javascript_application",
  "inspect_android_package", "inspect_managed_artifact", "list_browser_targets",
  "inspect_firmware_regions", "get_evidence_bundle", "inspect_analysis_view",
]);

function slug(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unnamed";
}

function register(tools, registry, used, server, tool, options = {}) {
  const prefix = `mcp__${slug(server.name)}__`;
  const raw = `${prefix}${slug(tool.name)}`;
  const digest = createHash("sha256").update(`${server.id}:${tool.name}`).digest("hex").slice(0, 12);
  let name = raw;
  if (!OPENAI_TOOL_NAME.test(name) || used.has(name)) {
    name = `${raw.slice(0, 64 - digest.length - 1)}_${digest}`;
  }
  if (used.has(name)) return;
  used.add(name);
  tools.push({
    type: "function",
    function: {
      name,
      description: tool.description || `MCP tool ${tool.name} from ${server.name}`,
      parameters: tool.inputSchema || { type: "object", properties: {}, additionalProperties: true },
    },
  });
  registry.push({ name, server, toolName: tool.name, ...options });
}

export function buildMcpToolRegistry(serversWithTools) {
  const tools = [];
  const registry = [];
  const used = new Set();
  for (const { server, toolList } of serversWithTools) {
    const isRea = server.name?.toLowerCase() === "rea" || (server.command === "npx" && (server.args || []).some((arg) => /^rea-agents(?:@|$)/i.test(arg)));
    for (const tool of toolList) {
      if (isRea && !REA_DIRECT_TOOLS.has(tool.name)) continue;
      register(tools, registry, used, server, tool);
    }
    if (!isRea) continue;

    register(tools, registry, used, server, {
      name: "discover_tools",
      description: "Search the complete REA MCP inventory by name/description. Returns matching names, descriptions and input schemas (max 5 per page). Use call_tool for tools not registered directly.",
      inputSchema: {
        type: "object", properties: {
          query: { type: "string", description: "Case-insensitive term, e.g. 'native ui', 'xrefs', or 'compare'. Empty query lists names." },
          offset: { type: "integer", minimum: 0, default: 0 },
        }, additionalProperties: false,
      },
    }, { virtual: "discover", inventory: toolList });
    register(tools, registry, used, server, {
      name: "call_tool",
      description: "Call a REA MCP tool from discover_tools by its exact native name. Supports the entire verified REA inventory; the server validates arguments. Use direct REA tools when available.",
      inputSchema: {
        type: "object", properties: {
          name: { type: "string", description: "Exact REA tool name returned by discover_tools" },
          arguments: { type: "object", description: "Parameters matching the discovered tool input schema", additionalProperties: true },
        }, required: ["name"], additionalProperties: false,
      },
    }, { virtual: "call", inventory: toolList });
  }
  return { tools, registry };
}

export function resolveMcpRegistryCall(entry, args = {}) {
  if (entry.virtual === "discover") {
    const query = String(args.query || "").trim().toLowerCase();
    const offset = Number.isSafeInteger(args.offset) && args.offset >= 0 ? args.offset : 0;
    const matches = entry.inventory.filter((tool) => `${tool.name} ${tool.description || ""}`.toLowerCase().includes(query));
    return { result: { total: matches.length, offset, tools: matches.slice(offset, offset + 5).map((tool) => ({
      name: tool.name,
      description: String(tool.description || "").slice(0, 300),
      inputSchema: tool.inputSchema,
    })) } };
  }
  if (entry.virtual === "call") {
    const tool = entry.inventory.find((item) => item.name === args.name);
    if (!tool) return { result: { ok: false, error: `Unknown REA MCP tool: ${String(args.name || "")}` } };
    return { name: tool.name, arguments: args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments : {} };
  }
  return { name: entry.toolName, arguments: args };
}
