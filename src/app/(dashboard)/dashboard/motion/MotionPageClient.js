"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { Button, Select, Input, ModelSelectModal } from "@/shared/components";
import { compileMotionCode } from "@/lib/motion/compile";

const SIZES = [
  { value: "1920x1080", label: "Landscape 16:9 (1920x1080)" },
  { value: "1080x1920", label: "Portrait 9:16 (1080x1920)" },
  { value: "1080x1080", label: "Square 1:1 (1080x1080)" },
];
const FPS = 30;
const MODEL_KEY = "motion.llmModel";
const HISTORY_KEY = "motion.history";

const STARTER = `export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12 } });
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#111827", justifyContent: "center", alignItems: "center" }}>
      <div style={{ color: "white", fontSize: width / 14, fontWeight: 700, opacity, transform: \`scale(\${scale})\` }}>
        Hello Motion
      </div>
    </AbsoluteFill>
  );
};`;

function useCompiled(code) {
  return useMemo(() => {
    try {
      return { Component: compileMotionCode(code), error: "" };
    } catch (e) {
      return { Component: null, error: e.message };
    }
  }, [code]);
}

export default function MotionPageClient() {
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [model, setModel] = useState("");
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(SIZES[0].value);
  const [seconds, setSeconds] = useState(5);
  const [code, setCode] = useState(STARTER);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [runtimeError, setRuntimeError] = useState("");
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const pollRef = useRef(null);

  const [width, height] = size.split("x").map(Number);
  const durationInFrames = Math.max(1, Math.round(Number(seconds) * FPS) || FPS);
  const { Component, error: compileError } = useCompiled(code);
  const codeError = compileError || runtimeError;

  useEffect(() => {
    setModel(localStorage.getItem(MODEL_KEY) || "");
    try {
      const savedHistory = localStorage.getItem(HISTORY_KEY);
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {}
    Promise.all([fetch("/api/providers"), fetch("/api/models/alias")])
      .then(([p, a]) => Promise.all([p.json().catch(() => ({})), a.json().catch(() => ({}))]))
      .then(([p, a]) => {
        setActiveProviders(p.connections || []);
        setModelAliases(a.aliases || {});
      })
      .catch((e) => setError(e.message));
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => setRuntimeError(""), [code]);

  // ponytail: localStorage-backed history capped at 50 items. Migrate to SQLite motionRepo if cloud sync or shared team library is needed.
  const saveHistory = (next) => {
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {}
  };

  const updateHistoryVideo = (targetId, video) => {
    setHistory((prev) => {
      const next = prev.map((item) =>
        item.id === targetId ? { ...item, videoUrl: video.url, videoSize: video.size } : item
      );
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const saveSnapshot = () => {
    const snapId = `motion-${Date.now()}`;
    const entry = {
      id: snapId,
      prompt: prompt.trim() || "Manual snapshot",
      model: model || "",
      code,
      size,
      seconds: Number(seconds) || 5,
      videoUrl: job?.status === "done" && job?.video?.url ? job.video.url : undefined,
      videoSize: job?.status === "done" && job?.video?.size ? job.video.size : undefined,
      createdAt: Date.now(),
    };
    saveHistory([entry, ...history.filter((i) => i.id !== snapId)].slice(0, 50));
    setCurrentHistoryId(snapId);
  };

  const loadHistoryItem = (item) => {
    setPrompt(item.prompt || "");
    if (item.model) {
      setModel(item.model);
      localStorage.setItem(MODEL_KEY, item.model);
    }
    if (item.size) setSize(item.size);
    if (item.seconds) setSeconds(item.seconds);
    setCode(item.code || "");
    setCurrentHistoryId(item.id);
    if (item.videoUrl) {
      setJob({ status: "done", video: { url: item.videoUrl, size: item.videoSize } });
    } else {
      setJob(null);
    }
    setError("");
  };

  const deleteHistoryItem = (e, id) => {
    e.stopPropagation();
    const updated = history.filter((i) => i.id !== id);
    saveHistory(updated);
    if (currentHistoryId === id) setCurrentHistoryId(null);
  };

  const clearHistory = () => {
    if (!confirm("Are you sure you want to clear all motion history?")) return;
    saveHistory([]);
    setCurrentHistoryId(null);
  };

  const copyCode = (e, codeText, id) => {
    e.stopPropagation();
    if (!codeText) return;
    navigator.clipboard?.writeText(codeText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.toLowerCase();
    return history.filter(
      (item) =>
        (item.prompt && item.prompt.toLowerCase().includes(q)) ||
        (item.model && item.model.toLowerCase().includes(q))
    );
  }, [history, historySearch]);

  const selectModel = (m) => {
    const v = m?.value || m?.name || m || "";
    setModel(v);
    localStorage.setItem(MODEL_KEY, v);
    setModelModalOpen(false);
  };

  const generate = async ({ refine = false, fix = false } = {}) => {
    if (!model) return setError("Select an LLM model first");
    if (!fix && !prompt.trim()) return setError("Prompt is required");
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/motion/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          width,
          height,
          fps: FPS,
          durationInFrames,
          previousCode: refine || fix ? code : "",
          compileError: fix ? codeError : "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Generate failed (${res.status})`);
      setCode(data.code);

      const newId = `motion-${Date.now()}`;
      const entry = {
        id: newId,
        prompt: prompt.trim() || (fix ? "LLM Fix" : "Motion Composition"),
        model,
        code: data.code,
        size,
        seconds: Number(seconds) || 5,
        createdAt: Date.now(),
      };
      saveHistory([entry, ...history.filter((i) => i.id !== newId)].slice(0, 50));
      setCurrentHistoryId(newId);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const render = async () => {
    setError("");
    clearInterval(pollRef.current);

    let targetId = currentHistoryId;
    if (!targetId || !history.some((h) => h.id === targetId)) {
      targetId = `motion-${Date.now()}`;
      setCurrentHistoryId(targetId);
      const snapshot = {
        id: targetId,
        prompt: prompt.trim() || "Motion Composition",
        model: model || "",
        code,
        size,
        seconds: Number(seconds) || 5,
        createdAt: Date.now(),
      };
      saveHistory([snapshot, ...history.filter((i) => i.id !== targetId)].slice(0, 50));
    }

    const res = await fetch("/api/motion/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, width, height, fps: FPS, durationInFrames }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || `Render failed (${res.status})`);
    setJob(data.job);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/motion/render?id=${data.job.id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        clearInterval(pollRef.current);
        setJob((j) => ({ ...j, status: "error", error: d.error || "Render job lost" }));
        return;
      }
      setJob(d.job);
      if (d.job.status !== "running") {
        clearInterval(pollRef.current);
        if (d.job.status === "done" && d.job.video) {
          updateHistoryVideo(targetId, d.job.video);
        }
      }
    }, 1000);
  };

  const rendering = job?.status === "running";

  return (
    <div className="flex flex-1 min-h-0 h-full w-full flex-col lg:flex-row overflow-hidden bg-bg text-text-main">
      <aside className="w-full lg:max-w-md shrink-0 border-b lg:border-b-0 lg:border-r border-border overflow-y-auto custom-scrollbar p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Motion Video</h1>
            <p className="text-xs text-text-muted mt-0.5">Prompt to Remotion component, live preview, render to MP4</p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              historyOpen
                ? "bg-brand-500 text-white border-brand-500 shadow-xs"
                : "border-border bg-surface-2 text-text-muted hover:text-text-main hover:bg-surface-3"
            }`}
            title="Toggle generation history"
            aria-label="Generation history"
          >
            <span className="material-symbols-outlined text-[16px]">history</span>
            <span>History</span>
            {history.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                historyOpen ? "bg-white/20 text-white" : "bg-brand-500/15 text-brand-500"
              }`}>
                {history.length}
              </span>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setModelModalOpen(true)}
          className="w-full flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-left hover:bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <span className="material-symbols-outlined text-brand-500">smart_toy</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{model || "Select LLM model"}</span>
            <span className="block text-xs text-text-muted">Writes the component code</span>
          </span>
        </button>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Animated intro: logo text slides in, then 3 feature bullets appear one by one"
            className="w-full rounded-[10px] bg-surface-2 border border-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-y"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Size" options={SIZES} value={size} onChange={(e) => setSize(e.target.value)} />
          <Input
            label="Duration (s)"
            type="number"
            min={1}
            max={300}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button icon="auto_awesome" loading={generating} onClick={() => generate()}>Generate</Button>
          <Button variant="outline" icon="edit" disabled={generating} onClick={() => generate({ refine: true })}>
            Refine current
          </Button>
          <Button
            variant="ghost"
            icon="bookmark_add"
            disabled={generating}
            onClick={saveSnapshot}
            title="Save current snapshot to history"
          >
            Save
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-500 flex items-start gap-1">
            <span className="material-symbols-outlined text-[14px]">error</span>
            {error}
          </p>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Component code</span>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            rows={18}
            className="w-full rounded-[10px] bg-surface-2 border border-transparent px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-y"
          />
        </label>
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-4">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            {Component && !codeError ? (
              <Player
                key={code}
                component={Component}
                durationInFrames={durationInFrames}
                fps={FPS}
                compositionWidth={width}
                compositionHeight={height}
                controls
                loop
                acknowledgeRemotionLicense
                style={{ width: "100%", maxHeight: "70vh", aspectRatio: `${width} / ${height}` }}
                errorFallback={({ error: err }) => {
                  queueMicrotask(() => setRuntimeError(err.message));
                  return null;
                }}
              />
            ) : (
              <div className="p-6 space-y-3">
                <p className="text-sm font-semibold text-red-500">Preview error</p>
                <pre className="whitespace-pre-wrap text-xs text-text-muted font-mono">{codeError}</pre>
                <Button size="sm" variant="outline" icon="build" loading={generating} onClick={() => generate({ fix: true })}>
                  Fix with LLM
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button icon="movie" variant="success" loading={rendering} disabled={!!codeError} onClick={render}>
              Render MP4
            </Button>
            {job && (
              <span className="text-xs text-text-muted" aria-live="polite">
                {job.status === "running" && `${job.stage}${job.stage === "rendering" ? ` ${Math.round(job.progress * 100)}%` : "…"}`}
                {job.status === "error" && <span className="text-red-500">Render failed: {job.error}</span>}
                {job.status === "done" && "Done"}
              </span>
            )}
          </div>

          {job?.status === "done" && job.video && (
            <div className="space-y-2">
              <video src={job.video.url} controls className="w-full rounded-xl border border-border" style={{ maxHeight: "70vh" }} />
              <a href={`${job.video.url}?download=1`} className="inline-flex items-center gap-1 text-sm text-brand-500 hover:underline">
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download MP4
              </a>
            </div>
          )}
        </div>
      </section>

      {/* History Drawer / Panel */}
      {historyOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs z-30 lg:hidden"
            onClick={() => setHistoryOpen(false)}
            aria-hidden="true"
          />
          <aside
            aria-label="Motion generation history"
            className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 border-l border-border bg-surface p-4 flex flex-col shrink-0 shadow-2xl lg:shadow-none lg:static lg:z-auto transition-transform"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-500 text-[20px]">history</span>
                <h2 className="text-sm font-semibold">History</h2>
                <span className="text-xs text-text-muted">({filteredHistory.length})</span>
              </div>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="text-xs text-text-muted hover:text-red-500 px-2 py-1 rounded-md hover:bg-surface-2 transition-colors cursor-pointer"
                    title="Clear all history"
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="text-text-muted hover:text-text-main p-1 rounded-md hover:bg-surface-2 cursor-pointer"
                  title="Close history"
                  aria-label="Close history"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {history.length > 1 && (
              <div className="pt-3">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
                    search
                  </span>
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search history..."
                    className="w-full text-xs bg-surface-2 border border-border rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  {historySearch && (
                    <button
                      type="button"
                      onClick={() => setHistorySearch("")}
                      className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main text-[16px]"
                    >
                      close
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar pt-3 space-y-2.5">
              {filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
                  <span className="material-symbols-outlined text-3xl mb-2 opacity-40">history_toggle_off</span>
                  <p className="text-xs font-medium">
                    {history.length === 0 ? "No history yet" : "No matches found"}
                  </p>
                  <p className="text-[11px] mt-1 max-w-[200px] opacity-70">
                    {history.length === 0
                      ? "Generated motion graphics and rendered videos will appear here."
                      : "Try searching with a different keyword."}
                  </p>
                </div>
              ) : (
                filteredHistory.map((item) => {
                  const isActive = currentHistoryId === item.id;
                  const dateStr = item.createdAt
                    ? new Date(item.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";
                  const sizeLabel = SIZES.find((s) => s.value === item.size)?.label.split(" ")[0] || item.size || "16:9";

                  return (
                    <div
                      key={item.id}
                      onClick={() => loadHistoryItem(item)}
                      className={`group relative p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        isActive
                          ? "bg-brand-500/10 border-brand-500 shadow-xs ring-1 ring-brand-500/30"
                          : "bg-surface-2 border-border hover:border-brand-500/40 hover:bg-surface-3"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-text-main line-clamp-2 leading-snug">
                          {item.prompt || "Untitled composition"}
                        </p>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={(e) => copyCode(e, item.code, item.id)}
                            className="p-1 text-text-muted hover:text-text-main hover:bg-surface rounded-md transition-colors"
                            title="Copy code"
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              {copiedId === item.id ? "check" : "content_copy"}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => deleteHistoryItem(e, item.id)}
                            className="p-1 text-text-muted hover:text-red-500 hover:bg-surface rounded-md transition-colors"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[15px]">delete</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded-md bg-surface font-mono text-text-muted border border-border/50">
                          {sizeLabel}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-md bg-surface font-mono text-text-muted border border-border/50">
                          {item.seconds}s
                        </span>
                        {item.model && (
                          <span className="px-1.5 py-0.5 rounded-md bg-surface text-text-muted border border-border/50 max-w-[110px] truncate" title={item.model}>
                            {item.model}
                          </span>
                        )}
                        {item.videoUrl && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-500/15 text-green-600 dark:text-green-400 font-semibold border border-green-500/20">
                            <span className="material-symbols-outlined text-[11px]">movie</span>
                            MP4
                          </span>
                        )}
                      </div>

                      {dateStr && (
                        <div className="flex items-center justify-between text-[10px] text-text-muted mt-2 pt-1.5 border-t border-border/40">
                          <span>{dateStr}</span>
                          {isActive && (
                            <span className="text-brand-500 font-semibold flex items-center gap-0.5">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-500"></span>
                              Active
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </>
      )}

      <ModelSelectModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        onSelect={selectModel}
        selectedModel={model}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select LLM for Motion code"
      />
    </div>
  );
}
