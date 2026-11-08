"use client";

import { useState } from "react";
import { Badge, Button, Card, ConfirmModal } from "@/shared/components";
import { formatBytes, formatDate, formatNumber } from "./format";

export default function HistoryPanel({ jobs, onReload, onReuse }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/elevenlabs/jobs/${pendingDelete.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menghapus");
      setPendingDelete(null);
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card title="History" subtitle="Terbaru di atas · audio disimpan lokal di server 9router">
      {error ? <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
      <div className="space-y-3">
        {jobs.length === 0 ? <p className="text-sm text-text-muted">Belum ada hasil generate.</p> : null}
        {jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={job.status === "completed" ? "success" : "error"} dot>
                {job.status}
              </Badge>
              <span className="text-sm text-text-main">{job.voiceName || job.voiceId}</span>
              <span className="text-xs text-text-muted">
                {job.model} · {formatNumber(job.characterCost)} credits
                {job.latencyMs ? ` · ${job.latencyMs} ms` : ""}
                {job.bytes ? ` · ${formatBytes(job.bytes)}` : ""}
              </span>
              {job.accountName ? (
                <Badge variant="info" size="sm">
                  {job.accountName}
                </Badge>
              ) : null}
              <span className="ml-auto text-xs text-text-muted">{formatDate(job.createdAt)}</span>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-text-muted">{job.text}</p>
            {job.error ? <p className="mt-1 text-xs text-red-500">{job.error}</p> : null}
            {job.hasAudio ? <audio src={`/api/elevenlabs/audio/${job.id}`} controls preload="none" className="mt-3 w-full max-w-xl" /> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" icon="replay" onClick={() => onReuse(job)}>
                Pakai lagi
              </Button>
              {job.hasAudio ? (
                <a
                  href={`/api/elevenlabs/audio/${job.id}?download=1`}
                  className="inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-sm text-text-main hover:bg-surface-2"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Download
                </a>
              ) : null}
              <Button variant="ghost" size="sm" icon="delete" onClick={() => setPendingDelete(job)}>
                Hapus
              </Button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus hasil generate?"
        message="Baris history dan file audionya akan dihapus dari server ini. Credit yang sudah terpakai tidak kembali."
        confirmText="Hapus"
        cancelText="Batal"
        loading={deleting}
      />
    </Card>
  );
}
