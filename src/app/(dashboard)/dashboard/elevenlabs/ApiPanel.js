"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card } from "@/shared/components";

const ENDPOINTS = [
  { method: "POST", path: "/v1/elevenlabs/tts", desc: "Generate audio. Default membalas bytes audio; response_format=json membalas job + audio_url." },
  { method: "GET", path: "/v1/elevenlabs/voices", desc: "Voice di akun. ?source=library&language=id&search=… untuk Voice Library." },
  { method: "GET", path: "/v1/elevenlabs/models", desc: "Model TTS (pengali credit, max karakter) dan output format." },
  { method: "GET", path: "/v1/elevenlabs/credits", desc: "Sisa credit akun aktif, pemakaian hari ini, limit harian." },
  { method: "GET", path: "/v1/elevenlabs/jobs", desc: "History generate. ?limit=50&offset=0 (limit maks 200)." },
  { method: "GET", path: "/v1/elevenlabs/jobs/{id}", desc: "Detail satu job." },
  { method: "DELETE", path: "/v1/elevenlabs/jobs/{id}", desc: "Hapus job beserta file audionya." },
  { method: "GET", path: "/v1/elevenlabs/audio/{id}", desc: "Unduh audio job. ?download=1 untuk attachment." },
];

const FIELDS = [
  ["text", "wajib", "Teks yang dibacakan (alias: input)."],
  ["voice_id", "opsional", "Default dari tab Config."],
  ["model_id", "opsional", "Default dari tab Config, mis. eleven_v4."],
  ["output_format", "opsional", "mp3_44100_128 · mp3_44100_192 · mp3_44100_64 · mp3_22050_32 · opus_48000_128"],
  ["language_code", "opsional", "id, en, … (string kosong = deteksi otomatis)."],
  ["voice_settings", "opsional", "{ stability, similarity_boost, style, use_speaker_boost, speed }"],
  ["seed", "opsional", "Integer, untuk hasil yang bisa diulang."],
  ["account_id", "opsional", "Paksa satu akun (melewati rotasi)."],
  ["voice_name", "opsional", "Label yang disimpan di history."],
  ["library_owner_id", "opsional", "public_owner_id voice dari Voice Library (otomatis ditambahkan ke akun)."],
  ["response_format", "opsional", "audio (default) atau json."],
];

const METHOD_VARIANT = { GET: "info", POST: "success", DELETE: "error" };

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin): the text is still selectable.
    }
  }
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 pr-20 font-mono text-xs leading-relaxed text-text-main">
        {code}
      </pre>
      <div className="absolute right-2 top-2">
        <Button variant="outline" size="sm" icon={copied ? "check" : "content_copy"} onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export default function ApiPanel({ config }) {
  // Only rendered after the user opens the API tab, so window is always there; the fallback covers SSR.
  const [origin] = useState(() => (typeof window === "undefined" ? "http://localhost:20128" : window.location.origin));

  const voiceId = config?.defaultVoiceId || "JBFqnCBsd6RMkjVDRZzb";
  const model = config?.defaultModel || "eleven_v4";
  const lang = config?.defaultLanguageCode || "id";

  const examples = useMemo(() => {
    const body = JSON.stringify({ text: "Halo, ini suara dari 9Router.", voice_id: voiceId, model_id: model, language_code: lang });
    return {
      audio: `curl -X POST ${origin}/v1/elevenlabs/tts \\
  -H "Authorization: Bearer YOUR_9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}' \\
  --output halo.mp3`,
      json: `curl -X POST "${origin}/v1/elevenlabs/tts?response_format=json" \\
  -H "Authorization: Bearer YOUR_9ROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'

# → 201 { "job": { "id": "…", "characterCost": 29, "audioUrl": "${origin}/v1/elevenlabs/audio/…", … },
#         "attempts": [], "switchedTo": null }`,
      js: `const res = await fetch("${origin}/v1/elevenlabs/tts", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + process.env.NINEROUTER_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ text: "Halo!", voice_id: "${voiceId}", model_id: "${model}" }),
});
if (!res.ok) throw new Error((await res.json()).error.message);
const jobId = res.headers.get("X-Job-Id");
const cost = res.headers.get("X-Character-Cost");
fs.writeFileSync("halo.mp3", Buffer.from(await res.arrayBuffer()));`,
      python: `import os, requests

r = requests.post(
    "${origin}/v1/elevenlabs/tts",
    headers={"Authorization": f"Bearer {os.environ['NINEROUTER_API_KEY']}"},
    json={"text": "Halo!", "voice_id": "${voiceId}", "model_id": "${model}"},
    timeout=200,
)
r.raise_for_status()
open("halo.mp3", "wb").write(r.content)
print(r.headers["X-Job-Id"], r.headers["X-Character-Cost"])`,
      voices: `curl "${origin}/v1/elevenlabs/voices?source=library&language=id&search=narrator" \\
  -H "Authorization: Bearer YOUR_9ROUTER_API_KEY"`,
    };
  }, [origin, voiceId, model, lang]);

  const [snippet, setSnippet] = useState("audio");
  const SNIPPETS = [
    { value: "audio", label: "curl (audio)" },
    { value: "json", label: "curl (json)" },
    { value: "js", label: "JavaScript" },
    { value: "python", label: "Python" },
    { value: "voices", label: "Voice Library" },
  ];

  return (
    <div className="space-y-5">
      <Card title="API ElevenLabs Studio" subtitle="Pipeline yang sama dengan tab Generate: rotasi akun, limit credit harian, history, dan audio tersimpan.">
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            Base URL: <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-text-main">{origin}/v1/elevenlabs</code>
          </p>
          <p>
            Autentikasi: header <code className="font-mono text-text-main">Authorization: Bearer &lt;API key 9Router&gt;</code> (atau{" "}
            <code className="font-mono text-text-main">x-api-key</code>). Buat key di{" "}
            <Link href="/dashboard/endpoint" className="text-brand-500 underline">
              Endpoint
            </Link>
            . Request dari mesin ini (localhost) boleh tanpa key kecuali opsi <i>Require API key</i> aktif. Key yang dibatasi (restricted) harus
            mencantumkan provider <code className="font-mono text-text-main">elevenlabs</code> di allow list.
          </p>
          <p>
            Error berbentuk <code className="font-mono text-text-main">{`{ "error": { "message", "code" } }`}</code>. Kode penting:{" "}
            <code className="font-mono">daily_budget</code> (429, limit harian tercapai), <code className="font-mono">no_account</code> (400), 402 jika
            credit semua akun habis.
          </p>
        </div>
      </Card>

      <Card title="Endpoint">
        <div className="divide-y divide-border">
          {ENDPOINTS.map((e) => (
            <div key={`${e.method} ${e.path}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="flex min-w-0 shrink-0 items-center gap-2 sm:w-80">
                <Badge variant={METHOD_VARIANT[e.method] || "default"}>{e.method}</Badge>
                <code className="truncate font-mono text-xs text-text-main">{e.path}</code>
              </div>
              <p className="text-sm text-text-muted">{e.desc}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Body POST /v1/elevenlabs/tts" subtitle="Bisa camelCase (voiceId) atau snake_case ala ElevenLabs (voice_id).">
        <div className="divide-y divide-border">
          {FIELDS.map(([name, req, desc]) => (
            <div key={name} className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-3">
              <div className="flex shrink-0 items-center gap-2 sm:w-56">
                <code className="font-mono text-xs text-text-main">{name}</code>
                {req === "wajib" ? <Badge variant="warning">wajib</Badge> : null}
              </div>
              <p className="break-words text-sm text-text-muted">{desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Response audio menyertakan header <code className="font-mono">X-Job-Id</code>, <code className="font-mono">X-Character-Cost</code>,{" "}
          <code className="font-mono">X-Model</code>, <code className="font-mono">X-Voice-Id</code>.
        </p>
      </Card>

      <Card title="Contoh">
        <div className="mb-3 flex flex-wrap gap-2">
          {SNIPPETS.map((s) => (
            <Button key={s.value} size="sm" variant={snippet === s.value ? "primary" : "outline"} onClick={() => setSnippet(s.value)}>
              {s.label}
            </Button>
          ))}
        </div>
        <CodeBlock code={examples[snippet]} />
      </Card>
    </div>
  );
}
