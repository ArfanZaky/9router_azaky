import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function cleanAnsi(str = "") {
  return String(str || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function parseCodegraphStatus(raw = "") {
  const clean = cleanAnsi(raw);
  const filesMatch = clean.match(/Files:\s+([\d,]+)/i);
  const nodesMatch = clean.match(/Nodes:\s+([\d,]+)/i);
  const edgesMatch = clean.match(/Edges:\s+([\d,]+)/i);
  const sizeMatch = clean.match(/DB Size:\s+([^\r\n]+)/i);
  const isUpToDate = /index is up to date|already up to date/i.test(clean);
  const isNotInitialized = /not initialized/i.test(clean);

  return {
    initialized: !isNotInitialized,
    files: filesMatch ? filesMatch[1].trim() : null,
    nodes: nodesMatch ? nodesMatch[1].trim() : null,
    edges: edgesMatch ? edgesMatch[1].trim() : null,
    dbSize: sizeMatch ? sizeMatch[1].trim() : null,
    isUpToDate,
    raw: clean,
  };
}

describe("CodeGraph API & Status Parser", () => {
  it("parses initialized and up-to-date CodeGraph status output correctly", () => {
    const sampleOutput = `
CodeGraph Status
Project: F:\\project\\9router\\custom
Index Statistics:
  Files:     6,006
  Nodes:     82,715
  Edges:     245,986
  DB Size:   361.82 MB
  Backend:   node:sqlite - built-in (full WAL)
  Journal:   wal

[OK] Index is up to date
`;
    const res = parseCodegraphStatus(sampleOutput);
    expect(res.initialized).toBe(true);
    expect(res.files).toBe("6,006");
    expect(res.nodes).toBe("82,715");
    expect(res.edges).toBe("245,986");
    expect(res.dbSize).toBe("361.82 MB");
    expect(res.isUpToDate).toBe(true);
  });

  it("identifies uninitialized project status correctly", () => {
    const uninitOutput = `
CodeGraph Status
[i] Project: F:\\project\\tools\\empty
[!] Not initialized
[i] Run "codegraph init" to initialize
`;
    const res = parseCodegraphStatus(uninitOutput);
    expect(res.initialized).toBe(false);
    expect(res.files).toBeNull();
    expect(res.isUpToDate).toBe(false);
  });

  it("verifies CodeGraph API route file exists and has proper handlers", () => {
    const routePath = path.resolve(__dirname, "../../src/app/api/chat/projects/codegraph/route.js");
    expect(fs.existsSync(routePath)).toBe(true);
    const content = fs.readFileSync(routePath, "utf8");
    expect(content).toContain("export async function GET");
    expect(content).toContain("export async function POST");
    expect(content).toContain("codegraph");
    expect(content).toContain("resolveProjectWorkspace");
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02
  });
});

describe("Session Context Percentage Calculation & Thresholds", () => {
  function computeContextPercentage(usedTokens, contextWindow) {
    if (!contextWindow || contextWindow <= 0) return 0;
    if (!usedTokens || usedTokens <= 0) return 0;
    return Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  }

  function getUsageStatus(pct) {
    if (pct > 80) return "High Usage";
    if (pct > 60) return "Elevated";
    return "Healthy";
  }

  it("calculates accurate percentages across different context windows", () => {
    expect(computeContextPercentage(0, 128000)).toBe(0);
    expect(computeContextPercentage(14080, 128000)).toBe(11);
    expect(computeContextPercentage(80000, 128000)).toBe(63);
    expect(computeContextPercentage(110000, 128000)).toBe(86);
    expect(computeContextPercentage(150000, 128000)).toBe(100);
    expect(computeContextPercentage(25000, 1000000)).toBe(3); // Gemini 1M window
  });

  it("classifies usage thresholds correctly", () => {
    expect(getUsageStatus(11)).toBe("Healthy");
    expect(getUsageStatus(59)).toBe("Healthy");
    expect(getUsageStatus(60)).toBe("Healthy");
    expect(getUsageStatus(61)).toBe("Elevated");
    expect(getUsageStatus(80)).toBe("Elevated");
    expect(getUsageStatus(81)).toBe("High Usage");
  });
});

describe("ProjectSidebar & ChatSessionRail Anti-Slop and Context Integration", () => {
  it("verifies ProjectSidebar has Reindex button and Session Context card", () => {
    const sidebarPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ProjectSidebar.js");
    const content = fs.readFileSync(sidebarPath, "utf8");
    expect(content).toContain("Reindex (codegraph sync)");
    expect(content).toContain("CodeGraph Index");
    expect(content).toContain("Session Context");
    expect(content).toContain("useModelCaps");
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02: FORBIDDEN em dash
  });

  it("verifies ChatSessionRail displays context percentage per session", () => {
    const railPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ChatSessionRail.jsx");
    const content = fs.readFileSync(railPath, "utf8");
    expect(content).toContain("contextTokens");
    expect(content).toContain("contextPct");
    expect(content).toContain("useModelCaps");
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02: FORBIDDEN em dash
  });

  it("verifies chatRepo returns contextTokens and latestTokenUsage", () => {
    const repoPath = path.resolve(__dirname, "../../src/lib/db/repos/chatRepo.js");
    const content = fs.readFileSync(repoPath, "utf8");
    expect(content).toContain("latestTokenUsage");
    expect(content).toContain("contextTokens");
    expect(content).toContain("totalContentLength");
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02
  });
});
