// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 18;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

export const TABLES = {
  _meta: { columns: { key: "TEXT PRIMARY KEY", value: "TEXT NOT NULL" } },
  settings: { columns: { id: "INTEGER PRIMARY KEY CHECK (id = 1)", data: "TEXT NOT NULL" } },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: { id: "TEXT PRIMARY KEY", type: "TEXT", name: "TEXT", data: "TEXT NOT NULL", createdAt: "TEXT NOT NULL", updatedAt: "TEXT NOT NULL" },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: { id: "TEXT PRIMARY KEY", isActive: "INTEGER DEFAULT 1", testStatus: "TEXT", data: "TEXT NOT NULL", createdAt: "TEXT NOT NULL", updatedAt: "TEXT NOT NULL" },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // Per-key access control. Additive columns, picked up by
      // syncSchemaFromTables() on boot; existing rows read as unrestricted (0).
      accessRestricted: "INTEGER DEFAULT 0",
      accessAllow: "TEXT",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)"],
  },
  combos: {
    columns: { id: "TEXT PRIMARY KEY", name: "TEXT UNIQUE NOT NULL", kind: "TEXT", models: "TEXT NOT NULL", createdAt: "TEXT NOT NULL", updatedAt: "TEXT NOT NULL" },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: { scope: "TEXT NOT NULL", key: "TEXT NOT NULL", value: "TEXT NOT NULL" },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
    ],
  },
  usageDaily: { columns: { dateKey: "TEXT PRIMARY KEY", data: "TEXT NOT NULL" } },
  quotaCache: {
    columns: { connectionId: "TEXT PRIMARY KEY", provider: "TEXT NOT NULL", data: "TEXT NOT NULL", cachedAt: "TEXT NOT NULL" },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_qc_provider ON quotaCache(provider)"],
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  chatSessions: {
    columns: {
      id: "TEXT PRIMARY KEY",
      title: "TEXT",
      model: "TEXT",
      providerId: "TEXT",
      systemPrompt: "TEXT",
      params: "TEXT",
      pinned: "INTEGER DEFAULT 0",
      workspacePath: "TEXT",
      projectMeta: "TEXT",
      tasks: "TEXT",
      codebase: "TEXT",
      knowledgeBaseIds: "TEXT",
      teamState: "TEXT",
      compactSummary: "TEXT",
      compactedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cs_updated ON chatSessions(updatedAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_cs_pinned ON chatSessions(pinned DESC, updatedAt DESC)",
    ],
  },
  chatGoals: {
    columns: { id: "TEXT PRIMARY KEY", sessionId: "TEXT NOT NULL", text: "TEXT NOT NULL", status: "TEXT NOT NULL", iterations: "INTEGER DEFAULT 0", judgeResult: "TEXT", createdAt: "TEXT NOT NULL", updatedAt: "TEXT NOT NULL" },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_cg_session ON chatGoals(sessionId, status)"],
  },
  chatMessages: {
    columns: {
      id: "TEXT PRIMARY KEY",
      sessionId: "TEXT NOT NULL",
      role: "TEXT NOT NULL",
      content: "TEXT",
      attachments: "TEXT",
      status: "TEXT",
      error: "TEXT",
      tokenUsage: "TEXT",
      toolCallId: "TEXT",
      toolName: "TEXT",
      toolCalls: "TEXT",
      reasoning: "TEXT",
      segments: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_cm_session ON chatMessages(sessionId, createdAt)"],
  },
  chatRuns: {
    columns: {
      id: "TEXT PRIMARY KEY",
      sessionId: "TEXT NOT NULL",
      mode: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      request: "TEXT",
      result: "TEXT",
      error: "TEXT",
      createdAt: "TEXT NOT NULL",
      startedAt: "TEXT",
      finishedAt: "TEXT",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cr_session ON chatRuns(sessionId, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_cr_status ON chatRuns(status, updatedAt DESC)",
    ],
  },
  chatRunEvents: {
    columns: { runId: "TEXT NOT NULL", seq: "INTEGER NOT NULL", type: "TEXT NOT NULL", data: "TEXT NOT NULL", createdAt: "TEXT NOT NULL" },
    primaryKey: "PRIMARY KEY (runId, seq)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_cre_run_seq ON chatRunEvents(runId, seq)"],
  },
  chatSubAgents: {
    columns: {
      id: "TEXT PRIMARY KEY",
      runId: "TEXT NOT NULL",
      sessionId: "TEXT NOT NULL",
      role: "TEXT",
      task: "TEXT NOT NULL",
      status: "TEXT NOT NULL",
      result: "TEXT",
      error: "TEXT",
      createdAt: "TEXT NOT NULL",
      startedAt: "TEXT",
      finishedAt: "TEXT",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_csa_run ON chatSubAgents(runId, createdAt)", "CREATE INDEX IF NOT EXISTS idx_csa_session ON chatSubAgents(sessionId, createdAt DESC)"],
  },
  chatSubAgentEvents: {
    columns: { subAgentId: "TEXT NOT NULL", seq: "INTEGER NOT NULL", type: "TEXT NOT NULL", data: "TEXT NOT NULL", createdAt: "TEXT NOT NULL" },
    primaryKey: "PRIMARY KEY (subAgentId, seq)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_csae_agent_seq ON chatSubAgentEvents(subAgentId, seq)"],
  },
  chatMcpServers: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      url: "TEXT NOT NULL",
      transport: "TEXT NOT NULL",
      command: "TEXT",
      args: "TEXT",
      env: "TEXT",
      enabled: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_cms_enabled ON chatMcpServers(enabled)"],
  },
  chatShortcodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      tag: "TEXT NOT NULL UNIQUE",
      description: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_cshort_tag ON chatShortcodes(tag)"],
  },
  imageJobs: {
    columns: {
      id: "TEXT PRIMARY KEY",
      prompt: "TEXT NOT NULL",
      negativePrompt: "TEXT",
      model: "TEXT",
      providerId: "TEXT",
      params: "TEXT",
      status: "TEXT",
      error: "TEXT",
      favorite: "INTEGER DEFAULT 0",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ij_created ON imageJobs(createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_ij_favorite ON imageJobs(favorite DESC, createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_ij_model ON imageJobs(model)",
    ],
  },
  imageAssets: {
    columns: {
      id: "TEXT PRIMARY KEY",
      jobId: "TEXT NOT NULL",
      path: "TEXT",
      mime: "TEXT",
      width: "INTEGER",
      height: "INTEGER",
      sourceUrl: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_ia_job ON imageAssets(jobId)"],
  },
  videoPromptProjects: {
    columns: {
      id: "TEXT PRIMARY KEY",
      title: "TEXT",
      prompt: "TEXT NOT NULL",
      llmModel: "TEXT",
      imageModel: "TEXT",
      videoModel: "TEXT",
      style: "TEXT",
      targetEngine: "TEXT",
      characterDesc: "TEXT",
      scenes: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_vpp_updated ON videoPromptProjects(updatedAt DESC)"],
  },
  knowledgeBases: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT",
      embeddingModel: "TEXT",
      chunkSize: "INTEGER DEFAULT 512",
      chunkOverlap: "INTEGER DEFAULT 50",
      status: "TEXT DEFAULT 'ready'",
      docCount: "INTEGER DEFAULT 0",
      chunkCount: "INTEGER DEFAULT 0",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kb_updated ON knowledgeBases(updatedAt DESC)"],
  },
  knowledgeDocuments: {
    columns: {
      id: "TEXT PRIMARY KEY",
      kbId: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      type: "TEXT",
      size: "INTEGER DEFAULT 0",
      status: "TEXT DEFAULT 'pending'",
      chunkCount: "INTEGER DEFAULT 0",
      error: "TEXT",
      content: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_kd_kb ON knowledgeDocuments(kbId)",
      "CREATE INDEX IF NOT EXISTS idx_kd_status ON knowledgeDocuments(kbId, status)",
    ],
  },
  knowledgeChunks: {
    columns: {
      id: "TEXT PRIMARY KEY",
      kbId: "TEXT NOT NULL",
      docId: "TEXT NOT NULL",
      chunkIndex: "INTEGER NOT NULL",
      content: "TEXT NOT NULL",
      embedding: "TEXT",
      tokenCount: "INTEGER DEFAULT 0",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kc_kb ON knowledgeChunks(kbId)", "CREATE INDEX IF NOT EXISTS idx_kc_doc ON knowledgeChunks(docId)", "CREATE INDEX IF NOT EXISTS idx_kc_kb_idx ON knowledgeChunks(kbId, chunkIndex)"],
  },
  // Google Flow jobs (src/lib/flow/bridge.js). Rows survive restarts so a poll
  // on GET /v1/videos/{id} still answers after the browser or server restarted.
  flowJobs: {
    columns: {
      id: "TEXT PRIMARY KEY",
      projectId: "TEXT",
      mode: "TEXT NOT NULL",
      model: "TEXT NOT NULL",
      prompt: "TEXT NOT NULL",
      imagePath: "TEXT",
      duration: "INTEGER",
      aspect: "TEXT",
      resolution: "TEXT",
      creditCost: "INTEGER DEFAULT 0",
      status: "TEXT NOT NULL",
      step: "TEXT",
      error: "TEXT",
      mediaPath: "TEXT",
      sourceUrl: "TEXT",
      dryRun: "INTEGER DEFAULT 0",
      createdAt: "TEXT NOT NULL",
      startedAt: "TEXT",
      finishedAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_fj_created ON flowJobs(createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_fj_status ON flowJobs(status)",
    ],
  },
  flowCreditSnapshots: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      balance: "INTEGER NOT NULL",
      source: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_fcs_created ON flowCreditSnapshots(createdAt DESC)"],
  },
  // Reusable Flow image library. Separate from imageAssets because that table's
  // jobId is NOT NULL and SQLite cannot drop it without a table rebuild; these
  // rows stand alone and can belong to a character (characterId + view).
  flowImages: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT",
      path: "TEXT NOT NULL",
      mime: "TEXT",
      width: "INTEGER",
      height: "INTEGER",
      origin: "TEXT",
      characterId: "TEXT",
      view: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_fi_created ON flowImages(createdAt DESC)",
      "CREATE INDEX IF NOT EXISTS idx_fi_character ON flowImages(characterId)",
    ],
  },
  flowCharacters: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT NOT NULL",
      description: "TEXT",
      style: "TEXT",
      imageModel: "TEXT",
      refAssetId: "TEXT",
      status: "TEXT",
      error: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_fc_updated ON flowCharacters(updatedAt DESC)"],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
