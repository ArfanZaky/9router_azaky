"use client";

import { useRef, useState } from "react";
import { Badge, Button, Card, ConfirmModal } from "@/shared/components";

const STATUS_VARIANT = { imported: "success", skipped: "default", failed: "error", invalid: "error" };
const STATUS_LABEL = { imported: "Masuk", skipped: "Dilewati", failed: "Gagal", invalid: "Tidak valid" };
const MAX_FILE = 200 * 1024 * 1024;

function formatSize(n) {
  if (!n) return "";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AccountsBackupCard({ profiles = [], onReload }) {
  const [selected, setSelected] = useState(() => new Set());
  const [confirmExport, setConfirmExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [file, setFile] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const names = profiles.map((p) => p.name);
  const chosen = names.filter((n) => selected.has(n));
  const exportAll = chosen.length === 0;

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function runExport() {
    setConfirmExport(false);
    setExporting(true);
    setError("");
    try {
      const qs = exportAll ? "" : `?profiles=${encodeURIComponent(chosen.join(","))}`;
      const res = await fetch(`/api/flow/accounts/export${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Export gagal");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "flow-accounts.json";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setExporting(false);
    }
  }

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > MAX_FILE) {
      setError("File terlalu besar (maks 200 MB)");
      return;
    }
    setError("");
    setResult(null);
    setFile(f);
  }

  async function runImport() {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    try {
      let bundle;
      try {
        bundle = JSON.parse(await file.text());
      } catch {
        throw new Error("File bukan JSON yang valid");
      }
      const res = await fetch("/api/flow/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle, overwrite }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Import gagal");
      setResult(body);
      setFile(null);
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card
      title="Export / Import akun"
      subtitle="Backup sesi login Google tiap profil Flow (cookie + data akun), tanpa cache, riwayat, atau password tersimpan"
    >
      <div className="space-y-5">
        {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

        <div className="space-y-3">
          <p className="text-sm font-medium text-text-main">Export</p>
          {profiles.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {profiles.map((p) => (
                <label key={p.name} className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
                  <input type="checkbox" checked={selected.has(p.name)} onChange={() => toggle(p.name)} className="rounded border-border" />
                  <span>{p.name}</span>
                  {p.google_account ? <span className="text-xs text-text-muted">{p.google_account}</span> : null}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Belum ada profil.</p>
          )}
          <Button variant="outline" size="sm" icon="download" loading={exporting} disabled={!profiles.length} onClick={() => setConfirmExport(true)}>
            {exportAll ? `Export semua (${profiles.length})` : `Export ${chosen.length} profil`}
          </Button>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-text-main">Import</p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={pickFile} />
            <Button variant="ghost" size="sm" icon="upload_file" onClick={() => fileRef.current?.click()}>
              Pilih file export
            </Button>
            {file ? (
              <span className="text-xs text-text-muted">
                {file.name} · {formatSize(file.size)}
              </span>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="rounded border-border" />
            <span>Timpa profil yang namanya sama (profil lama dipindah ke folder profile-backups, tidak dihapus)</span>
          </label>
          <Button variant="primary" size="sm" icon="upload" loading={importing} disabled={!file} onClick={runImport}>
            Import
          </Button>
          <p className="text-xs leading-relaxed text-text-muted">
            Cookie Chrome di Windows terkunci ke user Windows yang membuatnya. Import mengembalikan sesi yang masih aktif di PC dan user Windows yang sama
            (backup / pulihkan). Di PC lain profil akan muncul, tetapi perlu login ulang lewat tombol login di atas. Setelah import, pakai tombol status
            untuk memastikan sesinya masih valid.
          </p>
        </div>

        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-text-main">
              {result.imported} masuk · {result.skipped} dilewati · {result.failed} gagal
            </p>
            <ul className="space-y-1 text-xs">
              {result.results.map((r, i) => (
                <li key={`${r.name}-${i}`} className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant={STATUS_VARIANT[r.status] || "default"}>
                    {STATUS_LABEL[r.status] || r.status}
                  </Badge>
                  <span className="text-text-main">{r.name}</span>
                  {r.googleAccount ? <span className="text-text-muted">{r.googleAccount}</span> : null}
                  <span className="text-text-muted">{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        isOpen={confirmExport}
        onClose={() => setConfirmExport(false)}
        onConfirm={runExport}
        title="Export sesi akun Google?"
        message="File ini berisi cookie login Google. Siapa pun yang memegangnya di PC ini bisa masuk ke akun-akun tersebut. Simpan di tempat aman, jangan dikirim ke chat, repo, atau cloud publik."
        confirmText="Download"
        cancelText="Batal"
        variant="primary"
      />
    </Card>
  );
}
