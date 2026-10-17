import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-account-details-"));
const originalDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = tempDir;

let db;
let adapter;
let buildRequestDetail;

beforeAll(async () => {
  const reqDetailMod = await import("open-sse/handlers/chatCore/requestDetail.js");
  buildRequestDetail = reqDetailMod.buildRequestDetail;

  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(() => {
  try {
    if (adapter?.close) adapter.close();
  } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (tempDir) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("buildRequestDetail — account attribution", () => {
  it("preserves explicit accountName and accountEmail", () => {
    const detail = buildRequestDetail({
      provider: "codebuddy",
      model: "seedance-2.5",
      connectionId: "conn-123",
      accountName: "Akun A",
      accountEmail: "user@example.com",
    });

    expect(detail.accountName).toBe("Akun A");
    expect(detail.accountEmail).toBe("user@example.com");
    expect(detail.connectionId).toBe("conn-123");
  });

  it("extracts account attribution from credentials object", () => {
    const credentials = {
      connectionId: "conn-cb",
      connectionName: "amara-sato4288",
      _connection: {
        name: "amara-sato4288",
        email: "amara@codebuddy.test",
      },
    };

    const detail = buildRequestDetail({
      provider: "codebuddy",
      model: "gpt-4",
      connectionId: credentials.connectionId,
      credentials,
    });

    expect(detail.accountName).toBe("amara-sato4288");
    expect(detail.accountEmail).toBe("amara@codebuddy.test");
  });
});

describe("requestDetailsRepo — account enrichment and persistence", () => {
  it("persists account info through saveRequestDetail and returns in getRequestDetails", async () => {
    const connId = "conn-codebuddy-alpha";
    const now = new Date().toISOString();
    adapter.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [connId, "codebuddy", "apikey", "Akun A (Production)", "akuna@company.com", 1, 1, "{}", now, now]
    );

    await db.saveRequestDetail({
      id: "req-with-account-1",
      provider: "codebuddy",
      model: "seedance-2.5",
      connectionId: connId,
      accountName: "Akun A (Production)",
      accountEmail: "akuna@company.com",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 20 },
      request: { messages: [] },
      response: { content: "ok" },
    });
    await db.flushRequestDetails();

    const result = await db.getRequestDetails({ provider: "codebuddy" });
    const row = result.details.find((d) => d.id === "req-with-account-1");

    expect(row).toBeDefined();
    expect(row.accountName).toBe("Akun A (Production)");
    expect(row.accountEmail).toBe("akuna@company.com");
    expect(row.connectionId).toBe(connId);
  });

  it("auto-enriches historical records that lack accountName in raw JSON", async () => {
    const historicalConnId = "conn-historical-99";
    const now = new Date().toISOString();
    adapter.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [historicalConnId, "codebuddy", "oauth", "felixcosta2993", "felix@gmail.com", 2, 1, "{}", now, now]
    );

    // Insert historical row directly into SQLite without accountName/accountEmail in data JSON
    const rawData = JSON.stringify({
      id: "req-hist-1",
      provider: "codebuddy",
      model: "claude-3-5-sonnet",
      connectionId: historicalConnId,
      timestamp: now,
      status: "success",
      tokens: { prompt_tokens: 50, completion_tokens: 50 },
    });

    adapter.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["req-hist-1", now, "codebuddy", "claude-3-5-sonnet", historicalConnId, "success", rawData]
    );

    const result = await db.getRequestDetails({ provider: "codebuddy" });
    const row = result.details.find((d) => d.id === "req-hist-1");

    expect(row).toBeDefined();
    expect(row.accountName).toBe("felixcosta2993");
    expect(row.accountEmail).toBe("felix@gmail.com");

    // Also verify getRequestDetailById enriches it
    const byId = await db.getRequestDetailById("req-hist-1");
    expect(byId).toBeDefined();
    expect(byId.accountName).toBe("felixcosta2993");
    expect(byId.accountEmail).toBe("felix@gmail.com");
  });

  it("enriches noauth connection as Public (No Auth)", async () => {
    await db.saveRequestDetail({
      id: "req-noauth-1",
      provider: "groq",
      model: "llama-3",
      connectionId: "noauth",
      status: "success",
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      request: { messages: [] },
      response: { content: "ok" },
    });
    await db.flushRequestDetails();

    const result = await db.getRequestDetails({ provider: "groq" });
    const row = result.details.find((d) => d.id === "req-noauth-1");

    expect(row).toBeDefined();
    expect(row.accountName).toBe("Public (No Auth)");
  });
});
