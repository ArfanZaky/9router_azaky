"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, Select, Toggle } from "@/shared/components";
import { formatNumber } from "./format";

const SLIDERS = [
  { key: "stability", label: "Stability", min: 0, max: 1, step: 0.05, hint: "Rendah = lebih ekspresif, tinggi = lebih stabil" },
  { key: "similarity_boost", label: "Similarity", min: 0, max: 1, step: 0.05, hint: "Seberapa mirip dengan suara asli" },
  { key: "style", label: "Style", min: 0, max: 1, step: 0.05, hint: "Melebih-lebihkan gaya bicara (menambah latensi)" },
  { key: "speed", label: "Speed", min: 0.7, max: 1.2, step: 0.05, hint: "1 = normal" },
];

const LANGUAGES = [
  { value: "id", label: "Indonesia" },
  { value: "en", label: "English" },
  { value: "ms", label: "Melayu" },
  { value: "ja", label: "Jepang" },
  { value: "ko", label: "Korea" },
  { value: "zh", label: "Mandarin" },
  { value: "ar", label: "Arab" },
  { value: "auto", label: "Otomatis (deteksi dari teks)" },
];

const langLabel = (code) => LANGUAGES.find((l) => l.value === code)?.label || code;
// "" (no language_code) is stored as "auto" in the UI: Select reserves "" for its placeholder.
const toUi = (code) => (code === "" ? "auto" : code);

function voiceLabel(v) {
  const meta = [v.gender, v.accent].filter(Boolean).join(", ");
  return `${v.name}${meta ? ` · ${meta}` : ""}`;
}

/** Fetch a voice list; state is keyed by URL so no setState runs synchronously in the effect. */
function useVoices(url) {
  const [state, setState] = useState({ url: "", voices: [], error: "" });
  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Gagal memuat voices");
        if (!cancelled) setState({ url, voices: body.voices || [], error: "" });
      })
      .catch((e) => {
        if (!cancelled) setState({ url, voices: [], error: String(e.message || e) });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const loading = Boolean(url) && state.url !== url;
  return { voices: loading ? [] : state.voices, error: loading ? "" : state.error, loading };
}

const textareaClass =
  "w-full min-h-[160px] resize-y rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-[16px] text-text-main placeholder-text-muted/70 focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm";

// The parent remounts this panel (key) when "Pakai lagi" sets a new prefill,
// so prefill only seeds initial state. Empty state falls back to config defaults.
export default function GeneratePanel({ models, config, outputFormats, accounts, activeAccount, prefill, onReload, onOpenAccounts }) {
  const hasPrefillSettings = prefill?.settings && Object.keys(prefill.settings).length > 0;
  const [text, setText] = useState(prefill?.text || "");
  const [modelState, setModel] = useState(prefill?.model || "");
  const [voiceIdState, setVoiceId] = useState(prefill?.voiceId || "");
  const [formatState, setOutputFormat] = useState(prefill?.outputFormat || "");
  const [accountId, setAccountId] = useState("");
  const [settingsState, setVoiceSettings] = useState(hasPrefillSettings ? prefill.settings : null);
  const [languageState, setLanguage] = useState(null);
  const [seed, setSeed] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const previewRef = useRef(null);

  const model = modelState || config?.defaultModel || "";
  const voiceId = voiceIdState || config?.defaultVoiceId || "";
  const outputFormat = formatState || config?.defaultOutputFormat || "";
  const voiceSettings = settingsState || config?.voiceSettings || null;
  const languageUi = languageState ?? toUi(config?.defaultLanguageCode ?? "id");
  const language = languageUi === "auto" ? "" : languageUi;

  const voiceAccount = accountId || activeAccount?.id || "";
  const acct = encodeURIComponent(voiceAccount);
  const current = useVoices(voiceAccount ? `/api/elevenlabs/voices?accountId=${acct}` : "");
  const voices = current.voices;

  const spec = useMemo(() => models.find((m) => m.id === model) || null, [models, model]);
  const chars = text.trim().length;
  const estimate = spec ? Math.ceil(chars * spec.costMultiplier) : chars;
  const tooLong = spec ? chars > spec.maxChars : false;
  const voice = voices.find((v) => v.id === voiceId) || null;

  const voiceOptions = useMemo(() => {
    const q = voiceFilter.trim().toLowerCase();
    const filtered = q
      ? voices.filter((v) => `${v.name} ${v.gender} ${v.accent} ${v.locale || v.language} ${v.description}`.toLowerCase().includes(q))
      : voices;
    const opts = filtered.map((v) => ({ value: v.id, label: voiceLabel(v) }));
    // Keep the current choice selectable even when it is in the other list or filtered out.
    if (voiceId && !opts.some((o) => o.value === voiceId)) {
      opts.unshift({ value: voiceId, label: voice ? voiceLabel(voice) : `Voice ID ${voiceId}` });
    }
    return opts;
  }, [voices, voiceFilter, voiceId, voice]);

  function playPreview() {
    if (!voice?.previewUrl || !previewRef.current) return;
    previewRef.current.src = voice.previewUrl;
    previewRef.current.play().catch(() => {});
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/elevenlabs/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model,
          voiceId,
          voiceName: voice?.name || null,
          languageCode: language,
          outputFormat,
          voiceSettings,
          ...(accountId ? { accountId } : {}),
          ...(seed.trim() ? { seed: Number(seed) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Generate gagal");
      setResult(body.job);
      if (body.attempts?.length) {
        const moved = body.switchedTo ? ` Akun aktif sekarang: ${body.switchedTo.name}.` : "";
        setNotice(`Dilayani oleh ${body.job.accountName} setelah fallback: ${body.attempts.join(" · ")}.${moved}`);
      }
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
      onReload().catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }

  if (!accounts.length) {
    return (
      <Card title="Generate speech" subtitle="Belum ada akun ElevenLabs">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-text-muted">Tambahkan API key ElevenLabs dulu untuk mulai generate.</p>
          <Button variant="primary" size="sm" icon="person_add" onClick={onOpenAccounts}>
            Tambah API key
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card
        title="Generate speech"
        subtitle={spec ? `${spec.name} · ${formatNumber(chars)} karakter ≈ ${formatNumber(estimate)} credits` : `${formatNumber(chars)} karakter`}
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
          {notice ? <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-600">{notice}</div> : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="el-text" className="text-sm font-medium text-text-main">
              Teks<span className="ml-1 text-red-500">*</span>
            </label>
            <textarea
              id="el-text"
              className={textareaClass}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Halo semuanya! [excited] Hari ini kita coba fitur baru…"
              required
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="text-text-muted">Model v3/v4 mendukung audio tag seperti [laughs], [whispers], [sighs], [excited].</span>
              <span className={tooLong ? "text-red-500" : "text-text-muted"}>
                {formatNumber(chars)} / {formatNumber(spec?.maxChars)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Bahasa"
              value={languageUi}
              onChange={(e) => setLanguage(e.target.value)}
              options={LANGUAGES}
              placeholder="Pilih bahasa"
            />
            <Select
              label="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              options={models.map((m) => ({ value: m.id, label: `${m.name}${m.costMultiplier !== 1 ? ` (${m.costMultiplier}× credit)` : ""}` }))}
            />
            <Select label="Output" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} options={outputFormats} />
            <Select
              label="Akun"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              options={[
                { value: "", label: `Otomatis (${activeAccount?.name || "aktif"})` },
                ...accounts.map((a) => ({
                  value: a.id,
                  label: `${a.name}${a.credits ? ` (${formatNumber(a.credits.remaining)} cr${a.credits.tier ? ` · ${a.credits.tier}` : ""})` : ""}`,
                })),
              ]}
            />
          </div>

          <div className="space-y-3 rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <Input
              value={voiceFilter}
              onChange={(e) => setVoiceFilter(e.target.value)}
              placeholder="Cari nama, gender, aksen…"
              icon="search"
              aria-label="Cari voice"
            />

            <p className="text-xs text-text-muted">
              Voice akun bersifat multibahasa. Dengan model v3/v4{language ? ` dan Bahasa = ${langLabel(language)}` : ""}, voice ini membacakan teks dalam
              bahasa tersebut.
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <Select
                className="min-w-0 flex-1 basis-64"
                label={`Voice akun${current.loading ? " (memuat…)" : voices.length ? ` (${voiceOptions.length}/${voices.length})` : ""}`}
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                options={voiceOptions}
                placeholder="Pilih voice"
              />
              <Button type="button" variant="outline" size="sm" icon="play_arrow" disabled={!voice?.previewUrl} onClick={playPreview}>
                Preview
              </Button>
            </div>
            {voice ? (
              <p className="text-xs text-text-muted">
                {["Voice akun", voice.locale || voice.language, voice.category, voice.description]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                · <span className="font-mono">{voice.id}</span>
              </p>
            ) : null}
            {current.error ? <p className="text-xs text-red-500">{current.error}</p> : null}
            <audio ref={previewRef} className="hidden" />
          </div>

          <div>
            <Button type="button" variant="ghost" size="sm" icon={showAdvanced ? "expand_less" : "expand_more"} onClick={() => setShowAdvanced((v) => !v)}>
              Voice settings &amp; opsi lanjutan
            </Button>
            {showAdvanced && voiceSettings ? (
              <div className="mt-3 grid grid-cols-1 gap-4 rounded-[10px] border border-border-subtle p-3 sm:grid-cols-2">
                {SLIDERS.map((s) => (
                  <div key={s.key} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <label htmlFor={`el-${s.key}`} className="font-medium text-text-main">
                        {s.label}
                      </label>
                      <span className="tabular-nums text-text-muted">{Number(voiceSettings[s.key]).toFixed(2)}</span>
                    </div>
                    <input
                      id={`el-${s.key}`}
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={voiceSettings[s.key]}
                      onChange={(e) => setVoiceSettings({ ...voiceSettings, [s.key]: Number(e.target.value) })}
                      className="w-full accent-brand-500"
                    />
                    <p className="text-xs text-text-muted">{s.hint}</p>
                  </div>
                ))}
                <Toggle
                  checked={Boolean(voiceSettings.use_speaker_boost)}
                  onChange={(v) => setVoiceSettings({ ...voiceSettings, use_speaker_boost: v })}
                  label="Speaker boost"
                  description="Mempertegas kemiripan suara"
                />
                <Input label="Seed" value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} placeholder="acak" inputMode="numeric" />
                <div className="sm:col-span-2">
                  <Button type="button" variant="ghost" size="sm" icon="restart_alt" onClick={() => setVoiceSettings(null)}>
                    Kembalikan ke default config
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" icon="graphic_eq" loading={submitting} disabled={!chars || tooLong || !voiceId || !model}>
              Generate
            </Button>
          </div>
        </form>
      </Card>

      {result ? (
        <Card
          title="Hasil terakhir"
          subtitle={`${result.voiceName || result.voiceId} · ${result.model} · ${formatNumber(result.characterCost)} credits · ${result.latencyMs ?? "—"} ms · ${result.accountName || ""}`}
        >
          <audio src={`/api/elevenlabs/audio/${result.id}`} controls autoPlay className="w-full" />
          <div className="mt-3 flex justify-end">
            <a href={`/api/elevenlabs/audio/${result.id}?download=1`} className="text-sm text-brand-500 hover:underline">
              Download
            </a>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
