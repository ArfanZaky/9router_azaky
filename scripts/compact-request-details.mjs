import path from "node:path";

import Database from "better-sqlite3";

const apply = process.argv.includes("--apply");
const keepArg = process.argv.find((arg) => arg.startsWith("--keep="));
const keep = Math.max(0, Number.parseInt(keepArg?.split("=")[1] || "200", 10));
const dbPath = path.join(process.env.APPDATA, "9router", "db", "data.sqlite");
const db = new Database(dbPath, apply ? {} : { readonly: true });
const fields = ["latency", "tokens", "request", "providerRequest", "providerResponse", "response"];

function compactField(value, limit) {
  const serialized = JSON.stringify(value ?? {});
  if (serialized.length <= limit) return value ?? {};
  return {
    _truncated: true,
    _originalSize: serialized.length,
    _preview: serialized.substring(0, 200),
  };
}

try {
  const before = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes
    FROM requestDetails
  `).get();

  console.log(JSON.stringify({ dbPath, apply, keep, before }));
  if (!apply) process.exit(0);

  db.pragma("journal_mode = DELETE");
  let rewritten = 0;
  db.transaction(() => {
    db.prepare(`
      DELETE FROM requestDetails
      WHERE id NOT IN (
        SELECT id FROM requestDetails ORDER BY timestamp DESC LIMIT ?
      )
    `).run(keep);
  })();

  const rows = db.prepare("SELECT id, provider, data FROM requestDetails").all();
  db.transaction(() => {
    const update = db.prepare("UPDATE requestDetails SET data = ? WHERE id = ?");
    for (const row of rows) {
      const detail = JSON.parse(row.data);
      const limit = row.provider === "kiro" ? 16 * 1024 : 64 * 1024;
      let changed = false;
      for (const field of fields) {
        const compacted = compactField(detail[field], limit);
        if (compacted !== detail[field]) {
          detail[field] = compacted;
          changed = true;
        }
      }
      if (changed) {
        update.run(JSON.stringify(detail), row.id);
        rewritten += 1;
      }
    }
  })();
  db.exec("VACUUM");

  const after = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes
    FROM requestDetails
  `).get();
  console.log(JSON.stringify({ after, rewritten }));
} finally {
  db.close();
}
