import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { DATA_FILE } from "../src/lib/db/paths.js";
import { makeBackupDir, backupFile, pruneOldBackups } from "../src/lib/db/backup.js";
import { getAdapter } from "../src/lib/db/driver.js";
import { getProviderConnections } from "../src/lib/localDb.js";

const DEFAULT_SOURCE = "D:\\TeraBoxDownload\\GPTJson";
const SOURCE_DIR = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) || DEFAULT_SOURCE;
const DRY_RUN = process.argv.includes("--dry-run");
const NO_BACKUP = process.argv.includes("--no-backup");
const KEEP_TEMP = process.argv.includes("--keep-temp");

function usage() {
  console.log("Usage: node scripts/import-codex-gptjson.mjs [sourceDir] [--dry-run] [--no-backup] [--keep-temp]");
}

function toIsoTime(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function jwtExpiryIso(...tokens) {
  for (const token of tokens) {
    const payload = decodeJwtPayload(token);
    if (payload?.exp) {
      const iso = toIsoTime(payload.exp);
      if (iso) return iso;
    }
  }
  return null;
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function compareRecordFreshness(a, b) {
  const aSaved = Date.parse(a.savedAt || "") || 0;
  const bSaved = Date.parse(b.savedAt || "") || 0;
  if (aSaved !== bSaved) return aSaved - bSaved;
  const aExp = Date.parse(a.expiresAt || "") || 0;
  const bExp = Date.parse(b.expiresAt || "") || 0;
  return aExp - bExp;
}

function runPowerShell(args, env = {}) {
  const result = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "PowerShell command failed").trim());
  }
}

function extractZips(sourceDir, tempRoot) {
  const zipFiles = fs.readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith(".zip"))
    .map((name) => path.join(sourceDir, name));

  for (let i = 0; i < zipFiles.length; i++) {
    const zipPath = zipFiles[i];
    const dest = path.join(tempRoot, String(i + 1).padStart(4, "0"));
    fs.mkdirSync(dest, { recursive: true });
    runPowerShell([
      "-NoProfile",
      "-Command",
      "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:ZIP_PATH -DestinationPath $env:DEST_PATH -Force",
    ], { ZIP_PATH: zipPath, DEST_PATH: dest });
  }

  return zipFiles.length;
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__MACOSX") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json") && !entry.name.startsWith("._")) out.push(full);
  }
  return out;
}

function parseTokenFile(filePath, sourceRoot) {
  const raw = fs.readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);

  const email = normalizeEmail(obj.email);
  const refreshToken = obj.refresh_token || obj.refreshToken;
  const accessToken = obj.access_token || obj.accessToken;
  const idToken = obj.id_token || obj.idToken;

  if (obj.type && String(obj.type).toLowerCase() !== "codex") {
    return { skipped: true, reason: "non_codex" };
  }
  if (!email || !refreshToken) {
    return { skipped: true, reason: "missing_email_or_refresh_token" };
  }

  const idPayload = decodeJwtPayload(idToken) || {};
  const authClaims = idPayload["https://api.openai.com/auth"] || {};
  const savedAt = toIsoTime(obj.saved_at || obj.savedAt) || new Date().toISOString();
  const expiresAt = toIsoTime(obj.expired || obj.expires_at || obj.expiresAt)
    || jwtExpiryIso(accessToken, idToken);

  return {
    email,
    name: email,
    accessToken,
    refreshToken,
    idToken,
    expiresAt,
    savedAt,
    tokenSource: obj.token_source || obj.tokenSource || null,
    chatgptAccountId: authClaims.chatgpt_account_id || null,
    chatgptPlanType: authClaims.chatgpt_plan_type || (String(obj.token_source || "").toLowerCase().includes("team") ? "team" : null),
    sourceEntry: path.relative(sourceRoot, filePath),
  };
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

function buildConnectionRow({ record, existing, priority, now }) {
  const createdAt = existing?.createdAt || now;
  const updatedAt = now;
  const expiresIn = record.expiresAt
    ? Math.max(1, Math.floor((Date.parse(record.expiresAt) - Date.now()) / 1000))
    : undefined;

  const data = {
    ...(existing || {}),
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    idToken: record.idToken,
    lastRefreshAt: record.savedAt,
    testStatus: existing?.testStatus || "active",
    providerSpecificData: {
      ...(existing?.providerSpecificData || {}),
      ...(record.chatgptAccountId ? { chatgptAccountId: record.chatgptAccountId } : {}),
      ...(record.chatgptPlanType ? { chatgptPlanType: record.chatgptPlanType } : {}),
      ...(record.tokenSource ? { tokenSource: record.tokenSource } : {}),
      importedFrom: "GPTJson",
      importedAt: now,
      sourceEntry: record.sourceEntry,
    },
  };
  if (record.expiresAt) {
    data.expiresAt = record.expiresAt;
    data.expiresIn = expiresIn;
  }

  const {
    id: _id,
    provider: _provider,
    authType: _authType,
    name: _name,
    email: _email,
    priority: _priority,
    isActive: _isActive,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = data;

  return {
    id: existing?.id || randomUUID(),
    provider: "codex",
    authType: "oauth",
    name: existing?.name || record.name,
    email: record.email,
    priority: existing?.priority || priority,
    isActive: existing?.isActive === false ? 0 : 1,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    usage();
    throw new Error(`Source directory not found: ${SOURCE_DIR}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "9router-gptjson-"));
  const stats = {
    zipFiles: 0,
    jsonFiles: 0,
    parsed: 0,
    invalid: 0,
    skipped: 0,
    duplicateEmails: 0,
    uniqueEmails: 0,
    inserted: 0,
    updated: 0,
  };

  try {
    stats.zipFiles = extractZips(SOURCE_DIR, tempRoot);
    const jsonFiles = walkFiles(tempRoot);
    stats.jsonFiles = jsonFiles.length;

    const byEmail = new Map();
    const skipReasons = new Map();

    for (const file of jsonFiles) {
      try {
        const record = parseTokenFile(file, tempRoot);
        if (record.skipped) {
          stats.skipped++;
          skipReasons.set(record.reason, (skipReasons.get(record.reason) || 0) + 1);
          continue;
        }
        stats.parsed++;
        const previous = byEmail.get(record.email);
        if (previous) {
          stats.duplicateEmails++;
          if (compareRecordFreshness(previous, record) <= 0) byEmail.set(record.email, record);
        } else {
          byEmail.set(record.email, record);
        }
      } catch {
        stats.invalid++;
      }
    }

    stats.uniqueEmails = byEmail.size;

    const db = await getAdapter();
    db.checkpoint?.();

    let backupPath = null;
    if (!DRY_RUN && !NO_BACKUP) {
      const backupDir = makeBackupDir("before-codex-gptjson-import");
      backupPath = backupFile(DATA_FILE, backupDir, "data.sqlite");
      pruneOldBackups();
    }

    const existingCodex = await getProviderConnections({ provider: "codex" });
    const existingByEmail = new Map(existingCodex.map((conn) => [normalizeEmail(conn.email), conn]).filter(([email]) => email));
    let nextPriority = existingCodex.reduce((max, conn) => Math.max(max, conn.priority || 0), 0) + 1;
    const rows = [];
    const now = new Date().toISOString();

    for (const record of byEmail.values()) {
      const existing = existingByEmail.get(record.email);
      if (existing) stats.updated++;
      else stats.inserted++;
      rows.push(buildConnectionRow({
        record,
        existing,
        priority: existing?.priority || nextPriority++,
        now,
      }));
    }

    if (!DRY_RUN) {
      db.transaction(() => {
        for (const row of rows) {
          db.run(
            `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               provider=excluded.provider,
               authType=excluded.authType,
               name=excluded.name,
               email=excluded.email,
               priority=excluded.priority,
               isActive=excluded.isActive,
               data=excluded.data,
               updatedAt=excluded.updatedAt`,
            [
              row.id,
              row.provider,
              row.authType,
              row.name,
              row.email,
              row.priority,
              row.isActive,
              row.data,
              row.createdAt,
              row.updatedAt,
            ]
          );
        }
      });
      db.checkpoint?.();
    }

    const after = DRY_RUN
      ? existingCodex.length
      : (await getProviderConnections({ provider: "codex" })).length;

    console.log(JSON.stringify({
      sourceDir: SOURCE_DIR,
      dryRun: DRY_RUN,
      backupPath,
      ...stats,
      codexBefore: existingCodex.length,
      codexAfter: after,
      skipReasons: Object.fromEntries(skipReasons.entries()),
    }, null, 2));
  } finally {
    if (!KEEP_TEMP) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else {
      console.log(`Temp kept at: ${tempRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(`[import-codex-gptjson] ${error.message}`);
  process.exit(1);
});
