// Export / import of gflow Chrome profiles (the "accounts" of /dashboard/flow).
//
// A Flow account is a Chrome user-data dir at <gflow>/profile_<name> whose
// Google session lives in cookies. A backup carries only what that session
// needs (cookies, account + preference files, Local State with the cookie key),
// never caches, history or saved passwords, as one JSON file of base64 blobs.
//
// Chrome on Windows encrypts cookies with a key bound to the Windows user
// (DPAPI / app-bound encryption). A backup restores a working session on the
// same PC and Windows user; elsewhere the profile appears but needs a re-login.
import fs from "node:fs";
import path from "node:path";

const FORMAT = "9router-flow-profiles";
const VERSION = 1;
const NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PROFILE_BYTES = 60 * 1024 * 1024;

// Relative paths (POSIX) taken from a profile. Directories are copied recursively.
const INCLUDE = [
  "Local State",
  ".gflow_account",
  ".gflow_acl_v1",
  ".gflow_browser_strategy",
  ".gflow_locale",
  "Last Version",
  "Default/Preferences",
  "Default/Secure Preferences",
  "Default/Web Data",
  "Default/Network",
  "Default/Accounts",
  "Default/Local Storage",
  "Default/Session Storage",
];

export class FlowBackupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Root folder that holds profile_<name> dirs (same rule as composer.profileDir). */
export function gflowBaseDir() {
  return path.join(process.env.LOCALAPPDATA || "", "ffroliva", "gflow-cli");
}

function profilePath(name) {
  if (!NAME_RE.test(name)) throw new FlowBackupError(`Nama profil tidak valid: '${name}'`);
  return path.join(gflowBaseDir(), `profile_${name}`);
}

function walk(absRoot, rel, out) {
  const abs = path.join(absRoot, rel);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return; // optional entry missing
  }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(abs)) {
      if (child === "LOCK") continue; // leveldb lock file
      walk(absRoot, path.posix.join(rel, child), out);
    }
  } else if (stat.isFile()) {
    if (stat.size > MAX_FILE_BYTES) throw new FlowBackupError(`File terlalu besar di profil: ${rel}`);
    out.push(rel);
  }
}

function readProfile(name) {
  const root = profilePath(name);
  if (!fs.existsSync(root)) throw new FlowBackupError(`Folder profil '${name}' tidak ditemukan`, 404);
  const rels = [];
  for (const entry of INCLUDE) walk(root, entry, rels);
  if (!rels.some((r) => r.startsWith("Default/Network/Cookies"))) {
    throw new FlowBackupError(`Profil '${name}' belum punya cookie sesi (belum login?)`);
  }
  const files = {};
  let total = 0;
  for (const rel of rels) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(root, rel));
    } catch (e) {
      if (e.code === "EBUSY" || e.code === "EPERM") {
        throw new FlowBackupError(`Profil '${name}' sedang dipakai Chrome (render/login berjalan). Coba lagi setelah selesai.`, 409);
      }
      throw e;
    }
    total += buf.byteLength;
    if (total > MAX_PROFILE_BYTES) throw new FlowBackupError(`Profil '${name}' melebihi batas ukuran backup`);
    files[rel] = buf.toString("base64");
  }
  return { files, bytes: total };
}

/**
 * @param {Array<{name:string, google_account?:string}>} profiles from listFlowProfiles()
 * @param {string[]|null} only names to include; null = all
 */
export function exportFlowProfiles(profiles, only = null) {
  const wanted = only?.length ? profiles.filter((p) => only.includes(p.name)) : profiles;
  if (!wanted.length) throw new FlowBackupError("Tidak ada profil untuk di-export");
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    platform: process.platform,
    profiles: wanted.map((p) => {
      const { files, bytes } = readProfile(p.name);
      return { name: p.name, googleAccount: p.google_account || null, bytes, files };
    }),
  };
}

/** Resolve rel inside root; reject absolute paths and traversal. */
function safeJoin(root, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

const ALLOWED_PREFIXES = INCLUDE.map((p) => p.toLowerCase());
const isAllowed = (rel) => {
  const r = rel.replace(/\\/g, "/").toLowerCase();
  return ALLOWED_PREFIXES.some((p) => r === p || r.startsWith(`${p}/`));
};

/**
 * Restore profiles from an export. Existing profiles are skipped unless
 * overwrite is set; an overwritten profile is renamed to *.bak-<time>, not deleted.
 */
export function importFlowProfiles(bundle, { overwrite = false, activeNames = [] } = {}) {
  if (!bundle || bundle.format !== FORMAT || !Array.isArray(bundle.profiles)) {
    throw new FlowBackupError("Bukan file export akun Flow dari 9router");
  }
  if (bundle.version > VERSION) throw new FlowBackupError("Versi file export lebih baru dari 9router ini");
  const results = [];
  fs.mkdirSync(gflowBaseDir(), { recursive: true });

  for (const item of bundle.profiles.slice(0, 50)) {
    const name = String(item?.name || "").trim();
    const googleAccount = item?.googleAccount || null;
    if (!NAME_RE.test(name)) {
      results.push({ name, status: "invalid", message: "Nama profil tidak valid" });
      continue;
    }
    const files = item?.files && typeof item.files === "object" ? item.files : null;
    if (!files || !Object.keys(files).length) {
      results.push({ name, googleAccount, status: "invalid", message: "Profil kosong" });
      continue;
    }
    const root = profilePath(name);
    const exists = fs.existsSync(root);
    if (exists && !overwrite) {
      results.push({ name, googleAccount, status: "skipped", message: "Profil dengan nama ini sudah ada" });
      continue;
    }
    if (exists && activeNames.includes(name)) {
      results.push({ name, googleAccount, status: "skipped", message: "Profil sedang dipakai job Flow, tidak ditimpa" });
      continue;
    }

    // Write into a temp dir first so a bad entry never leaves a half-written profile.
    // Neither temp nor backup dirs start with "profile_": gflow lists those as accounts.
    const tmp = path.join(gflowBaseDir(), `.import-${name}-${Date.now()}`);
    try {
      let count = 0;
      for (const [rel, b64] of Object.entries(files)) {
        if (!isAllowed(rel)) continue;
        const abs = safeJoin(tmp, rel);
        if (!abs || typeof b64 !== "string") throw new FlowBackupError(`Path tidak valid di file export: ${String(rel).slice(0, 80)}`);
        const buf = Buffer.from(b64, "base64");
        if (buf.byteLength > MAX_FILE_BYTES) throw new FlowBackupError(`File terlalu besar: ${rel}`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, buf);
        count += 1;
      }
      if (!count) throw new FlowBackupError("Tidak ada file profil yang valid");
      let backup = null;
      if (exists) {
        const backupDir = path.join(gflowBaseDir(), "profile-backups");
        fs.mkdirSync(backupDir, { recursive: true });
        backup = path.join(backupDir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        fs.renameSync(root, backup);
      }
      fs.renameSync(tmp, root);
      results.push({
        name,
        googleAccount,
        status: "imported",
        message: backup ? `ditimpa (profil lama disimpan di profile-backups/${path.basename(backup)})` : `${count} file dipulihkan`,
      });
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      results.push({ name, googleAccount, status: "failed", message: String(e?.message || e).slice(0, 200) });
    }
  }
  return {
    imported: results.filter((r) => r.status === "imported").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed" || r.status === "invalid").length,
    sameMachineHint: bundle.platform === process.platform,
    results,
  };
}
