import { describe, expect, it, vi, beforeEach } from "vitest";

// In-memory adapter so compactSessionMessages runs against a real store, not a stub of itself.
const store = { sessions: new Map(), messages: [], runs: [], sessionRow: null };
let nextRowid = 1;

function fullRow(m) {
  return {
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content || "",
    attachments: m.attachments || "[]",
    status: m.status || "done",
    error: m.error || null,
    tokenUsage: m.tokenUsage || null,
    toolCallId: m.toolCallId || null,
    toolName: m.toolName || null,
    toolCalls: m.toolCalls || null,
    reasoning: m.reasoning || "",
    segments: m.segments || "[]",
    createdAt: m.createdAt || "2026-10-15T10:00:00.000Z",
  };
}

const adapter = {
  all(sql, params = []) {
    if (sql.includes("FROM chatMessages") && sql.includes("ORDER BY rowid ASC")) {
      return store.messages
        .filter((m) => m.sessionId === params[0])
        .sort((a, b) => a.rowid - b.rowid)
        .map((m) => (sql.includes("SELECT *") ? fullRow(m) : { rowid: m.rowid, role: m.role, content: m.content, toolCalls: m.toolCalls }));
    }
    return [];
  },
  get(sql, params = []) {
    if (sql.includes("FROM chatSessions s")) {
      return store.sessionRow ? { ...store.sessionRow, totalContentLength: 0, latestTokenUsage: null } : null;
    }
    if (sql.includes("FROM chatRuns")) {
      return store.runs[0] || null;
    }
    if (sql.includes("SELECT id, compactSummary FROM chatSessions")) {
      const s = store.sessions.get(params[0]);
      return s ? { id: s.id, compactSummary: s.compactSummary } : null;
    }
    if (sql.includes("SELECT id FROM chatSessions")) {
      const id = params[0];
      const exists = store.sessionRow?.id === id || store.sessions.has(id);
      return exists ? { id } : null;
    }
    if (sql.includes("SUM(LENGTH(content))")) {
      const len = store.messages
        .filter((m) => m.sessionId === params[0])
        .reduce((sum, m) => sum + String(m.content || "").length, 0);
      return { len };
    }
    if (sql.includes("ORDER BY rowid DESC LIMIT 1")) {
      const msgs = store.messages.filter((m) => m.sessionId === params[0]).sort((a, b) => b.rowid - a.rowid);
      return msgs[0] ? { id: msgs[0].id, tokenUsage: msgs[0].tokenUsage } : null;
    }
    return null;
  },
  run(sql, params = []) {
    if (sql.startsWith("INSERT OR REPLACE INTO chatMessages")) {
      const row = params;
      store.messages.push({
        id: row[0],
        sessionId: row[1],
        rowid: nextRowid++,
        role: row[2],
        content: row[3],
        attachments: row[4],
        status: row[5],
        error: row[6],
        tokenUsage: row[7],
        toolCallId: row[8],
        toolName: row[9],
        toolCalls: row[10],
        reasoning: row[11],
        segments: row[12],
        createdAt: row[13],
      });
      return { changes: 1 };
    }
    if (sql.startsWith("DELETE FROM chatMessages")) {
      const [sessionId, cutoff] = params;
      const doomed = store.messages.filter(
        (m) => m.sessionId === sessionId && (cutoff === undefined || m.rowid < cutoff)
      );
      store.messages = store.messages.filter((m) => !doomed.includes(m));
      return { changes: doomed.length };
    }
    if (sql.startsWith("UPDATE chatSessions SET compactSummary")) {
      const [compactSummary, compactedAt, updatedAt, id] = params;
      store.sessions.set(id, { id, compactSummary, compactedAt, updatedAt });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE chatSessions SET updatedAt")) return { changes: 1 };
    if (sql.startsWith("UPDATE chatMessages SET tokenUsage")) {
      const [tokenUsage, id] = params;
      const msg = store.messages.find((m) => m.id === id);
      if (msg) msg.tokenUsage = tokenUsage;
      return { changes: msg ? 1 : 0 };
    }
    return { changes: 0 };
  },
  transaction(fn) {
    return fn();
  },
};

vi.mock("../../src/lib/db/driver.js", () => ({ getAdapter: async () => adapter }));

const { compactSessionMessages, compactStartIndex, getChatSession } = await import("@/lib/db/repos/chatRepo.js");

function seedSession(id, messages) {
  store.sessions.set(id, { id, compactSummary: "" });
  store.messages = [];
  nextRowid = 1;
  for (const m of messages) {
    store.messages.push({
      id: `${id}-${nextRowid}`,
      rowid: nextRowid++,
      sessionId: id,
      role: m.role,
      content: m.content || "",
      toolCalls: m.toolCalls || null,
      tokenUsage: m.tokenUsage || null,
    });
  }
}

describe("chat compaction: summary instead of hard loss", () => {
  beforeEach(() => {
    store.sessions.clear();
    store.messages = [];
    nextRowid = 1;
  });

  it("keeps the window off an orphan tool result so tool_call pairs stay intact", () => {
    const msgs = [
      { role: "user" },
      { role: "assistant" },
      { role: "assistant" },
      { role: "tool" },
      { role: "tool" },
      { role: "assistant" },
    ];
    // naive slice(4) would start on a tool result
    expect(msgs.slice(4)[0].role).toBe("tool");
    expect(compactStartIndex(msgs, 2)).toBe(2);
    expect(msgs[compactStartIndex(msgs, 2)].role).not.toBe("tool");
  });

  it("summarizes dropped turns, keeps last N verbatim, and stores the digest on the session", async () => {
    const history = [
      { role: "user", content: "Refactor auth middleware" },
      { role: "assistant", content: "", toolCalls: [{ function: { name: "read_file" } }] },
      { role: "tool", content: "file body that must not be summarized" },
      { role: "assistant", content: "Auth middleware split into guard.js and session.js" },
      { role: "user", content: "Now add tests" },
      { role: "assistant", content: "Added 4 tests in auth.test.js" },
      { role: "user", content: "Run the suite" },
      { role: "assistant", content: "" },
      { role: "tool", content: "12 passed" },
      { role: "assistant", content: "All 12 tests pass" },
    ];
    seedSession("s1", history);

    const res = await compactSessionMessages("s1", 4);

    expect(res.deletedCount).toBe(6);
    expect(res.keptCount).toBe(4);
    expect(store.messages).toHaveLength(4);
    // window starts on an assistant, never on a dangling tool result
    expect(store.messages[0].role).not.toBe("tool");
    expect(res.summary).toContain("Refactor auth middleware");
    expect(res.summary).toContain("Auth middleware split into guard.js");
    expect(res.summary).toContain("Assistant ran tools: read_file");
    expect(res.summary).not.toContain("file body that must not be summarized");
    expect(store.sessions.get("s1").compactSummary).toBe(res.summary);
    expect(store.sessions.get("s1").compactedAt).toBeTruthy();
    expect(res.estimatedTokens).toBeGreaterThan(0);
  });

  it("accumulates earlier summaries and writes the token estimate even without prior usage rows", async () => {
    seedSession("s2", [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ]);
    await compactSessionMessages("s2", 2);
    expect(store.sessions.get("s2").compactSummary).toContain("old question");

    seedTwoMore("s2");
    const second = await compactSessionMessages("s2", 2);
    expect(second.summary).toContain("old question"); // earlier digest survives
    expect(second.summary).toContain("q2");

    const latest = store.messages[store.messages.length - 1];
    expect(JSON.parse(latest.tokenUsage).prompt_tokens).toBe(second.estimatedTokens);
  });
});

function seedTwoMore(sessionId) {
  for (const m of [
    { role: "user", content: "q4" },
    { role: "assistant", content: "a4" },
  ]) {
    store.messages.push({
      id: `${sessionId}-x${nextRowid}`,
      rowid: nextRowid++,
      sessionId,
      role: m.role,
      content: m.content,
      toolCalls: null,
      tokenUsage: null,
    });
  }
}

describe("chat compaction: self-heal must not undo it", () => {
  function seedToolHeavySession({ compactedAt, runCreatedAt }) {
    store.messages = [];
    nextRowid = 1;
    for (const m of [
      { role: "user", content: "do the thing" },
      { role: "tool", content: "tool output only" },
    ]) {
      store.messages.push({
        id: `m${nextRowid}`,
        rowid: nextRowid++,
        sessionId: "s3",
        role: m.role,
        content: m.content,
        toolCalls: null,
        tokenUsage: null,
      });
    }
    store.sessionRow = {
      id: "s3",
      title: "t",
      model: "",
      providerId: "",
      systemPrompt: "",
      params: "{}",
      pinned: 0,
      workspacePath: "",
      projectMeta: "{}",
      tasks: "[]",
      codebase: "",
      teamState: null,
      compactSummary: "digest of dropped turns",
      compactedAt,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: compactedAt || "2026-10-01T00:00:00Z",
    };
    store.runs = [
      {
        createdAt: runCreatedAt,
        result: JSON.stringify({
          messages: [
            { role: "user", content: "do the thing" },
            { role: "assistant", content: "full old transcript restored" },
            { role: "tool", content: "tool output only" },
          ],
        }),
      },
    ];
  }

  beforeEach(() => {
    store.sessions.clear();
    store.messages = [];
    store.runs = [];
    store.sessionRow = null;
    nextRowid = 1;
  });

  it("skips restoring a run snapshot that predates the last compaction", async () => {
    seedToolHeavySession({ compactedAt: "2026-10-20T00:00:00Z", runCreatedAt: "2026-10-19T00:00:00Z" });
    const session = await getChatSession("s3");
    expect(session.messages).toHaveLength(2);
    expect(session.compactSummary).toContain("digest of dropped turns");
  });

  it("still heals when the snapshot is newer than the compaction", async () => {
    seedToolHeavySession({ compactedAt: "2026-10-20T00:00:00Z", runCreatedAt: "2026-10-21T00:00:00Z" });
    const session = await getChatSession("s3");
    expect(session.messages).toHaveLength(3);
    expect(session.messages.some((m) => m.content === "full old transcript restored")).toBe(true);
  });
});
