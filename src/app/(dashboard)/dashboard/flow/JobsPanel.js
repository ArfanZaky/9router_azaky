"use client";

import { useState } from "react";
import { Badge, Button, Card } from "@/shared/components";

const STATUS_VARIANT = { queued: "default", running: "info", completed: "success", failed: "error" };

function when(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("id-ID", { hour12: false });
}

export default function JobsPanel({ jobs, onResume, reloading }) {
  const [resuming, setResuming] = useState("");

  async function resume(job) {
    setResuming(job.id);
    try {
      await onResume(job);
    } finally {
      setResuming("");
    }
  }

  return (
    <Card title="Jobs" subtitle="Terbaru di atas">
      <div className="space-y-3">
        {jobs.length === 0 ? <p className="text-sm text-text-muted">Belum ada job.</p> : null}
        {jobs.map((job) => (
          <div key={job.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[job.status] || "default"} dot>
                {job.status}
              </Badge>
              <span className="text-sm text-text-main">{job.model}</span>
              <span className="text-xs text-text-muted">
                {job.mode} · {job.duration}s · {job.aspect} · {job.creditCost} credits
              </span>
              <span className="ml-auto text-xs text-text-muted">{when(job.createdAt)}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-text-muted">{job.prompt}</p>
            {job.step ? <p className="mt-1 text-xs text-text-subtle">{job.step}</p> : null}
            {job.error ? <p className="mt-1 text-xs text-red-500">{job.error}</p> : null}
            {job.status === "completed" && job.mediaPath ? (
              <video src={`/api/video-prompt/media/${job.id}`} controls preload="metadata" className="mt-3 w-full max-w-md rounded-lg" />
            ) : null}
            {job.status === "failed" && job.mode === "i2v" ? (
              <Button variant="outline" size="sm" className="mt-2" loading={reloading || resuming === job.id} onClick={() => resume(job)}>
                Resume in Flow
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
