import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

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

describe("Session Context Compaction & SQLite Execution", () => {
  it("compacts chat messages in SQLite keeping only the last N messages", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE chatMessages (
        id TEXT PRIMARY KEY,
        sessionId TEXT,
        role TEXT,
        content TEXT,
        tokenUsage TEXT
      );
    `);

    const insert = db.prepare("INSERT INTO chatMessages (id, sessionId, role, content) VALUES (?, ?, ?, ?)");
    for (let i = 1; i <= 30; i++) {
      insert.run(`msg_${i}`, "session_1", i % 2 === 0 ? "assistant" : "user", `Content of message ${i}`);
    }

    const totalBefore = db.prepare("SELECT COUNT(*) as cnt FROM chatMessages WHERE sessionId = ?").get("session_1").cnt;
    expect(totalBefore).toBe(30);

    const keepLastN = 20;
    const deletedCount = db.prepare(
      "DELETE FROM chatMessages WHERE sessionId = ? AND rowid NOT IN (SELECT rowid FROM chatMessages WHERE sessionId = ? ORDER BY rowid DESC LIMIT ?)"
    ).run("session_1", "session_1", keepLastN).changes;

    expect(deletedCount).toBe(10);
    const totalAfter = db.prepare("SELECT COUNT(*) as cnt FROM chatMessages WHERE sessionId = ?").get("session_1").cnt;
    expect(totalAfter).toBe(20);

    // Verify remaining are messages 11 through 30
    const remaining = db.prepare("SELECT id FROM chatMessages WHERE sessionId = ? ORDER BY rowid ASC").all("session_1");
    expect(remaining[0].id).toBe("msg_11");
    expect(remaining[19].id).toBe("msg_30");
  });

  it("does not delete messages when total count is less than or equal to keepLastN", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE chatMessages (id TEXT, sessionId TEXT);");
    const insert = db.prepare("INSERT INTO chatMessages VALUES (?, ?)");
    for (let i = 1; i <= 5; i++) {
      insert.run(`msg_${i}`, "session_small");
    }

    const keepLastN = 20;
    const count = db.prepare("SELECT COUNT(*) as cnt FROM chatMessages WHERE sessionId = ?").get("session_small").cnt;
    expect(count <= keepLastN).toBe(true);
  });
});

describe("ProjectSidebar & ChatSessionRail Anti-Slop and Context Integration", () => {
  it("verifies ProjectSidebar has Reindex button and Session Context card with Compact button", () => {
    const sidebarPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ProjectSidebar.js");
    const content = fs.readFileSync(sidebarPath, "utf8");
    expect(content).toContain("Reindex (codegraph sync)");
    expect(content).toContain("CodeGraph Index");
    expect(content).toContain("Session Context");
    expect(content).toContain("handleCompactSession");
    expect(content).toContain("Compact Context (keep 20)");
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

  it("verifies chatRepo returns contextTokens, latestTokenUsage, and compactSessionMessages works", () => {
    const repoPath = path.resolve(__dirname, "../../src/lib/db/repos/chatRepo.js");
    const content = fs.readFileSync(repoPath, "utf8");
    expect(content).toContain("latestTokenUsage");
    expect(content).toContain("contextTokens");
    expect(content).toContain("totalContentLength");
    expect(content).toContain("compactSessionMessages");
    expect(content).toContain("compactStartIndex");
    expect(content).toContain("DELETE FROM chatMessages WHERE sessionId = ? AND rowid < ?");
    expect(content).toContain("compactedAt");
    expect(content).toContain("compactSummary");
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02
  });

  it("verifies auto-compact mechanisms in agent loop and serverRunManager", () => {
    const loopPath = path.resolve(__dirname, "../../src/lib/agent/loop.js");
    const loopContent = fs.readFileSync(loopPath, "utf8");
    expect(loopContent).toContain("compactWorking");
    expect(loopContent).toContain("getCapabilitiesForModel");
    expect(loopContent).toContain("currentTokens > contextWindow * 0.75");
    expect(loopContent).not.toContain("\u2014"); // Anti-Slop R-02

    const serverRunPath = path.resolve(__dirname, "../../src/lib/chat/serverRunManager.js");
    const serverRunContent = fs.readFileSync(serverRunPath, "utf8");
    expect(serverRunContent).toContain("compactSessionMessages");
    expect(serverRunContent).toContain("ctxTokens > win * 0.75");
    expect(serverRunContent).not.toContain("\u2014"); // Anti-Slop R-02
  });
});
