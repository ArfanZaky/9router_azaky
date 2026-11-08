"use client";

import { useRef, useState } from "react";
import { Badge, Button, Card, ConfirmModal } from "@/shared/components";

const STATUS_VARIANT = { imported: "success", skipped: "default", failed: "error", invalid: "error" };
const STATUS_LABEL = { imported: "Masuk", skipped: "Dilewati", failed: "Gagal", invalid: "Tidak valid" };

const textareaClass =
  "w-full min-h-[120px] resize-y rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 font-mono text-[16px] text-text-main placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-xs";

export default function ImportExportCard({ accountCount, onReload }) {
  const [exportFormat, setExportFormat] = useState(null);
  const [data, setData] = useState("");
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function download(format) {
    setExportFormat(null);
    setError("");
    try {
      const res = await fetch(`/api/elevenlabs/accounts/export?format=${format}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Export gagal");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || `elevenlabs-accounts.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError("File terlalu besar (maks 512 KB)");
      return;
    }
    setError("");
    setFileName(file.name);
    setData(await file.text());
    e.target.value = "";
  }

  async function runImport(e) {
    e.preventDefault();
    setImporting(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/elevenlabs/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", data }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Import gagal");
      setResult(body);
      if (body.imported) setData("");
      await onReload();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card title="Export / Import akun" subtitle="Nama akun + API key, untuk backup atau pindah ke 9router lain">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon="download" disabled={!accountCount} onClick={() => setExportFormat("json")}>
            Export JSON
          </Button>
          <Button variant="outline" size="sm" icon="description" disabled={!accountCount} onClick={() => setExportFormat("txt")}>
            Export TXT (name|apiKey)
          </Button>
          <span className="text-xs text-text-muted">{accountCount} akun</span>
        </div>

        <form onSubmit={runImport} className="space-y-3">
          {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="el-import" className="text-sm font-medium text-text-main">
              Import
            </label>
            <textarea
              id="el-import"
              className={textareaClass}
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setFileName("");
              }}
              placeholder={"eleven_utama|sk_xxxxxxxx\neleven_kedua|sk_yyyyyyyy\n\natau tempel isi file JSON hasil export"}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-text-muted">
              Satu akun per baris: <span className="font-mono">nama|apiKey</span> (pemisah | , ; atau tab), atau API key saja. File JSON hasil export juga
              bisa. Setiap key dicek ke ElevenLabs dulu; key yang sudah terdaftar dilewati.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".json,.txt,.csv,text/plain,application/json" className="hidden" onChange={pickFile} />
              <Button type="button" variant="ghost" size="sm" icon="upload_file" onClick={() => fileRef.current?.click()}>
                Pilih file
              </Button>
              {fileName ? <span className="text-xs text-text-muted">{fileName}</span> : null}
            </div>
            <Button type="submit" variant="primary" size="sm" icon="upload" loading={importing} disabled={!data.trim()}>
              Import
            </Button>
          </div>
        </form>

        {result ? (
          <div className="space-y-2">
            <p className="text-sm text-text-main">
              {result.imported} masuk · {result.skipped} dilewati · {result.failed} gagal
            </p>
            <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
              {result.results.map((r, i) => (
                <li key={`${r.name}-${i}`} className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant={STATUS_VARIANT[r.status] || "default"}>
                    {STATUS_LABEL[r.status] || r.status}
                  </Badge>
                  <span className="text-text-main">{r.name}</span>
                  {r.keyPreview ? <span className="font-mono text-text-muted">{r.keyPreview}</span> : null}
                  <span className="text-text-muted">{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        isOpen={Boolean(exportFormat)}
        onClose={() => setExportFormat(null)}
        onConfirm={() => download(exportFormat)}
        title="Export API key?"
        message="File berisi API key ElevenLabs dalam bentuk teks biasa. Siapa pun yang memegang file ini bisa memakai credit akun Anda. Simpan di tempat aman dan jangan diunggah ke repo atau chat."
        confirmText="Download"
        cancelText="Batal"
        variant="primary"
      />
    </Card>
  );
}
