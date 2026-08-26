"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Button, ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const STYLES = [
  "Cinematic 35mm (Arri Alexa, natural film grain)",
  "Photorealistic 8K Documentary",
  "Cyberpunk Neon & Wet Reflections",
  "Anime / Makoto Shinkai Style",
  "Dark Moody Gothic Fantasy",
  "Pixar 3D Animation Style",
  "Vintage 1970s Retro Film",
  "Surreal Dreamlike Fantasy",
];

const TARGET_ENGINES = [
  "General AI Video (Runway Gen-3 / Sora / Kling / Luma)",
  "Runway Gen-3 Alpha",
  "Kling AI (v1.5 / High Quality)",
  "Luma Dream Machine",
  "OpenAI Sora",
  "Hailuo Minimax Video-01",
  "xAI Grok Imagine Video",
  "Pika 2.0",
];

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "2.39:1 (Anamorphic)"];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function VideoPromptPageClient() {
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  // Model selection states
  const [llmModel, setLlmModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [showLlmModal, setShowLlmModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);

  // Storyboard generator inputs
  const [prompt, setPrompt] = useState("");
  const [characterDesc, setCharacterDesc] = useState("");
  const [style, setStyle] = useState(STYLES[0]);
  const [targetEngine, setTargetEngine] = useState(TARGET_ENGINES[0]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [sceneCount, setSceneCount] = useState(4);

  // Reference Image Upload (like /dashboard/image-gen)
  const [refImage, setRefImage] = useState("");
  const [refUrlDraft, setRefUrlDraft] = useState("");
  const [refDragging, setRefDragging] = useState(false);
  const refFileInputRef = useRef(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [characterConsistencyPrompt, setCharacterConsistencyPrompt] = useState("");
  const [scenes, setScenes] = useState([]);
  const [error, setError] = useState("");

  // Projects & History
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Per-scene image gen state: { [sceneNumber]: { running: bool, error: string, assetUrl: string } }
  const [imageGenStates, setImageGenStates] = useState({});
  const [batchGenRunning, setBatchGenRunning] = useState(false);

  const { copied, copy } = useCopyToClipboard(2000);

  // Load initial settings & providers
  useEffect(() => {
    (async () => {
      try {
        const [keysRes, providersRes, aliasesRes, projectsRes] = await Promise.all([
          fetch("/api/keys"),
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/video-prompt/projects"),
        ]);
        const keysData = await keysRes.json().catch(() => ({}));
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = await aliasesRes.json().catch(() => ({}));
        const projectsData = await projectsRes.json().catch(() => ({}));

        setApiKey((keysData.keys || []).find((k) => k.isActive !== false)?.key || "");
        setActiveProviders(providersData.connections || []);
        setModelAliases(aliasesData.aliases || {});
        setProjects(projectsData.projects || []);
      } catch (err) {
        console.error("Init failed", err);
      }
    })();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await fetch("/api/video-prompt/projects");
      const data = await res.json().catch(() => ({}));
      setProjects(data.projects || []);
    } catch (e) {
      console.error("Failed to load projects", e);
    }
  };

  const setRefFromFile = async (file) => {
    if (!file || !file.type?.startsWith("image/")) {
      setError("Reference must be an image file");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Reference image too large (max 15MB)");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setRefImage(dataUrl);
    setRefUrlDraft("");
    setError("");
  };

  const handleRefFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await setRefFromFile(file);
  };

  const handleRefDrop = async (event) => {
    event.preventDefault();
    setRefDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await setRefFromFile(file);
  };

  const applyRefUrl = () => {
    const url = refUrlDraft.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) {
      setError("Reference URL must start with http(s):// or data:image/");
      return;
    }
    setRefImage(url);
    setError("");
  };

  const clearRefImage = () => {
    setRefImage("");
    setRefUrlDraft("");
  };

  const handleGenerateStoryboard = async () => {
    if (!prompt.trim()) {
      setError("Please enter a story prompt or concept");
      return;
    }
    if (!llmModel) {
      setError("Please select an LLM model first");
      return;
    }

    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/video-prompt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          model: llmModel,
          style,
          sceneCount: Number(sceneCount),
          targetEngine,
          aspectRatio,
          characterDesc: characterDesc.trim(),
          refImage: refImage || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate video storyboard");
      }

      setProjectTitle(data.projectTitle || "Generated Storyboard");
      setCharacterConsistencyPrompt(data.characterConsistencyPrompt || "");
      const generatedScenes = (data.scenes || []).map((s, idx) => ({
        ...s,
        sceneNumber: s.sceneNumber || idx + 1,
        imageStatus: "idle",
        imageUrl: "",
      }));
      setScenes(generatedScenes);

      // Auto save project to DB
      const saveRes = await fetch("/api/video-prompt/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.projectTitle || "Untitled Storyboard",
          prompt: prompt.trim(),
          llmModel,
          imageModel,
          style,
          targetEngine,
          characterDesc: characterDesc.trim(),
          refImage: refImage || "",
          scenes: generatedScenes,
        }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (saved.project?.id) {
        setCurrentProjectId(saved.project.id);
        await loadProjects();
      }
    } catch (err) {
      setError(err.message || "Failed to generate storyboard");
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateSceneImage = async (scene, sceneIndex) => {
    if (!imageModel) {
      setError("Select an Image Model (kindFilter=image) first to generate first-frame stills");
      return;
    }
    if (!apiKey) {
      setError("No active API Key found in Endpoint & Key");
      return;
    }

    const sceneNum = scene.sceneNumber || sceneIndex + 1;
    setImageGenStates((prev) => ({
      ...prev,
      [sceneNum]: { running: true, error: "", assetUrl: prev[sceneNum]?.assetUrl || "" },
    }));

    try {
      // Determine reference image: either from previous scene or user uploaded refImage
      let imageRefToUse = "";
      if (sceneIndex > 0) {
        const prevScene = scenes[sceneIndex - 1];
        const prevAssetUrl = prevScene?.imageUrl || imageGenStates[prevScene?.sceneNumber]?.assetUrl;
        if (prevAssetUrl) {
          imageRefToUse = prevAssetUrl.startsWith("http")
            ? prevAssetUrl
            : `${window.location.origin}${prevAssetUrl}`;
        }
      }
      if (!imageRefToUse && refImage) {
        imageRefToUse = refImage;
      }

      const imgPrompt = `${scene.imagePrompt}${
        characterConsistencyPrompt ? `, Character ref: ${characterConsistencyPrompt}` : ""
      }`;

      const res = await fetch("/api/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: imageModel,
          prompt: imgPrompt,
          n: 1,
          size: aspectRatio === "9:16" ? "1024x1792" : aspectRatio === "1:1" ? "1024x1024" : "1792x1024",
          response_format: "b64_json",
          ...(imageRefToUse ? { image: imageRefToUse, images: [imageRefToUse] } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
      }

      const imageItems = (Array.isArray(data.data) ? data.data : []).filter(
        (item) => item?.b64_json || item?.url
      );
      if (!imageItems.length) {
        throw new Error("Provider returned no image data");
      }

      // Save to Image Gallery Assets SQLite
      const providerId = imageModel.includes("/") ? imageModel.split("/")[0] : "";
      const saveRes = await fetch("/api/image-gen/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt,
          model: imageModel,
          providerId,
          params: { sceneNumber: sceneNum, aspectRatio },
          status: "done",
          data: imageItems,
        }),
      });
      const job = await saveRes.json().catch(() => ({}));
      const asset = job.assets?.[0];
      const finalUrl = asset?.path ? `/api/image-gen/assets/${asset.id}` : asset?.sourceUrl || "";

      // Update scene state
      setScenes((prev) =>
        prev.map((s, idx) =>
          idx === sceneIndex ? { ...s, imageUrl: finalUrl, imageStatus: "done" } : s
        )
      );
      setImageGenStates((prev) => ({
        ...prev,
        [sceneNum]: { running: false, error: "", assetUrl: finalUrl },
      }));

      // Update project in DB if loaded
      if (currentProjectId) {
        const updatedScenes = scenes.map((s, idx) =>
          idx === sceneIndex ? { ...s, imageUrl: finalUrl, imageStatus: "done" } : s
        );
        fetch(`/api/video-prompt/projects/${currentProjectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenes: updatedScenes }),
        }).catch(() => {});
      }
    } catch (err) {
      setImageGenStates((prev) => ({
        ...prev,
        [sceneNum]: { running: false, error: err.message || "Image gen failed", assetUrl: "" },
      }));
    }
  };

  const handleGenerateAllImages = async () => {
    if (!imageModel) {
      setError("Please select an Image Model first");
      return;
    }
    setBatchGenRunning(true);
    setError("");
    for (let i = 0; i < scenes.length; i++) {
      await handleGenerateSceneImage(scenes[i], i);
    }
    setBatchGenRunning(false);
  };

  const handleUpdateSceneField = (index, field, value) => {
    setScenes((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, [field]: value } : s))
    );
  };

  const handleLoadProject = (proj) => {
    setCurrentProjectId(proj.id);
    setProjectTitle(proj.title || "");
    setPrompt(proj.prompt || "");
    if (proj.llmModel) setLlmModel(proj.llmModel);
    if (proj.imageModel) setImageModel(proj.imageModel);
    if (proj.style) setStyle(proj.style);
    if (proj.targetEngine) setTargetEngine(proj.targetEngine);
    if (proj.characterDesc) setCharacterDesc(proj.characterDesc);
    if (proj.refImage) setRefImage(proj.refImage);
    setScenes(proj.scenes || []);
    setHistoryOpen(false);
  };

  const handleDeleteProject = async (projId, e) => {
    e?.stopPropagation();
    try {
      await fetch(`/api/video-prompt/projects/${projId}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== projId));
      if (currentProjectId === projId) {
        setCurrentProjectId(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getFullMarkdownExport = () => {
    let md = `# ${projectTitle || "Video Storyboard"}\n\n`;
    md += `**Style:** ${style}  \n`;
    md += `**Target Engine:** ${targetEngine}  \n`;
    md += `**Aspect Ratio:** ${aspectRatio}  \n`;
    if (characterConsistencyPrompt) {
      md += `**Character Consistency Anchor:** ${characterConsistencyPrompt}\n\n`;
    }
    md += `---\n\n`;

    scenes.forEach((s) => {
      md += `### Scene ${s.sceneNumber} (${s.timecode || "00:00 - 00:05"})\n`;
      md += `**Summary:** ${s.summary || ""}\n\n`;
      md += `**Combined Motion Prompt (Production Text):**\n\`\`\`\n${s.motionPrompt}\n\`\`\`\n\n`;
      md += `**First-Frame Image Prompt:**\n\`\`\`\n${s.imagePrompt}\n\`\`\`\n\n`;
      md += `- **Camera:** ${s.camera || "-"}\n`;
      md += `- **Lighting:** ${s.lighting || "-"}\n`;
      md += `- **SFX:** ${s.audioSfx || "-"}\n`;
      if (s.voiceover) md += `- **Voiceover:** "${s.voiceover}"\n`;
      md += `\n---\n\n`;
    });

    return md;
  };

  return (
    <div className="flex flex-1 min-h-0 h-full w-full overflow-hidden bg-background text-text-main">
      {/* Left Sidebar: Controls & Generator Form */}
      <aside className="w-full max-w-md shrink-0 border-r border-border overflow-y-auto custom-scrollbar p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">movie_edit</span>
              Video Storyboard Gen
            </h1>
            <p className="text-xs text-text-muted mt-0.5">
              Scene-by-scene prompt generator with first-frame image sync
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="history"
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Saved Storyboards"
          >
            History
          </Button>
        </div>

        {/* History Drawer / Panel */}
        {historyOpen && (
          <div className="rounded-xl border border-border bg-sidebar/50 p-3 space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between text-xs font-semibold text-text-muted">
              <span>Saved Storyboards ({projects.length})</span>
              <button
                type="button"
                className="text-[11px] hover:text-primary"
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </div>
            {projects.length === 0 ? (
              <p className="text-xs text-text-muted">No saved projects yet</p>
            ) : (
              projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleLoadProject(p)}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs cursor-pointer transition ${
                    currentProjectId === p.id
                      ? "bg-primary/20 text-primary border border-primary/30"
                      : "hover:bg-sidebar border border-transparent"
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="font-semibold truncate">{p.title}</p>
                    <p className="text-[10px] text-text-muted truncate">
                      {p.scenes?.length || 0} scenes · {p.style}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteProject(p.id, e)}
                    className="material-symbols-outlined text-[15px] text-text-muted hover:text-red-500"
                    title="Delete"
                  >
                    delete
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Dual Model Selectors */}
        <div className="space-y-2">
          {/* 1. LLM Model */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              1. Storyboard Director LLM Model
            </label>
            <button
              type="button"
              onClick={() => setShowLlmModal(true)}
              className="w-full flex items-center justify-between rounded-xl border border-border bg-sidebar/50 px-3 py-2.5 text-left hover:bg-sidebar transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-primary text-[20px]">smart_toy</span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{llmModel || "Select Storyboard LLM"}</p>
                  <p className="text-[10px] text-text-muted">Claude 3.7 / GPT-4o / DeepSeek / Gemini</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
            </button>
          </div>

          {/* 2. Image Model */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              2. First-Frame Image Model
            </label>
            <button
              type="button"
              onClick={() => setShowImageModal(true)}
              className="w-full flex items-center justify-between rounded-xl border border-border bg-sidebar/50 px-3 py-2.5 text-left hover:bg-sidebar transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-amber-500 text-[20px]">image</span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{imageModel || "Select Image Generator"}</p>
                  <p className="text-[10px] text-text-muted">DALL-E 3 / FLUX.1 / SD / Imagen</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
            </button>
          </div>
        </div>

        {/* Story Concept / Prompt Textarea */}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">Story Concept / Script</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Describe your video story, scene idea, or full script..."
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary resize-y min-h-[90px]"
          />
        </label>

        {/* Reference Image Upload (Visual Concept / Character Ref) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-muted">Concept / Character Reference Image (Optional)</span>
            {refImage ? (
              <button type="button" onClick={clearRefImage} className="text-[11px] text-red-500 hover:underline">
                Remove
              </button>
            ) : null}
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setRefDragging(true);
            }}
            onDragLeave={() => setRefDragging(false)}
            onDrop={handleRefDrop}
            className={`rounded-xl border border-dashed p-3 transition ${
              refDragging
                ? "border-primary bg-primary/10"
                : refImage
                  ? "border-border bg-sidebar/40"
                  : "border-border hover:border-primary/50 hover:bg-sidebar/30"
            }`}
          >
            {refImage ? (
              <div className="flex items-start gap-3">
                <img
                  src={refImage}
                  alt="Reference"
                  className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover bg-black/10"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[11px] text-text-muted">
                    Reference image attached for vision analysis & scene-1 visual anchor.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => refFileInputRef.current?.click()}
                      className="rounded-lg border border-border px-2.5 py-1 text-[10px] hover:bg-sidebar"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={clearRefImage}
                      className="rounded-lg border border-border px-2.5 py-1 text-[10px] text-red-500 hover:bg-sidebar"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => refFileInputRef.current?.click()}
                className="w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[26px] text-primary">add_photo_alternate</span>
                  <div>
                    <p className="text-xs font-medium">Drop character/scene image or click to upload</p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      PNG/JPG/WebP · used as visual reference for storyboard & first still
                    </p>
                  </div>
                </div>
              </button>
            )}
            <input
              ref={refFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRefFile}
            />
          </div>
          <div className="flex gap-2">
            <input
              value={refUrlDraft}
              onChange={(e) => setRefUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyRefUrl();
                }
              }}
              placeholder="Or paste reference image URL…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={applyRefUrl}
              disabled={!refUrlDraft.trim()}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-sidebar disabled:opacity-40"
            >
              Use URL
            </button>
          </div>
        </div>

        {/* Character Consistency Anchor Text */}
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Consistent Character Anchor (Optional)</span>
            <span className="text-[10px] text-primary">Keeps face/outfit across scenes</span>
          </div>
          <input
            value={characterDesc}
            onChange={(e) => setCharacterDesc(e.target.value)}
            placeholder="e.g. 28yo Asian cyber-detective with neon blue hair, wearing leather trench coat"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          />
        </label>

        {/* Target Engine & Style Presets */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-text-muted space-y-1">
            <span>Target AI Platform</span>
            <select
              value={targetEngine}
              onChange={(e) => setTargetEngine(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-main"
            >
              {TARGET_ENGINES.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-text-muted space-y-1">
            <span>Visual Style</span>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-main"
            >
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Aspect Ratio & Scene Count */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-text-muted space-y-1">
            <span>Aspect Ratio</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-main"
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-text-muted space-y-1">
            <span>Scene Count</span>
            <input
              type="number"
              min={2}
              max={12}
              value={sceneCount}
              onChange={(e) => setSceneCount(Math.min(12, Math.max(2, Number(e.target.value) || 4)))}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-main"
            />
          </label>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <Button
          className="w-full"
          icon={generating ? "progress_activity" : "auto_awesome"}
          onClick={handleGenerateStoryboard}
          disabled={generating || !prompt.trim() || !llmModel}
        >
          {generating ? "Generating Storyboard Scenes…" : "Generate Video Storyboard"}
        </Button>
      </aside>

      {/* Main Board: Storyboard Scenes Grid & Stills */}
      <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top Header Bar */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-3.5 bg-sidebar/20">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {projectTitle || "Generated Storyboard Board"}
            </h2>
            <p className="text-[11px] text-text-muted truncate">
              {scenes.length} Scenes · Output formatted as unified production text prompts
            </p>
          </div>

          <div className="flex items-center gap-2">
            {scenes.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="copy_all"
                  onClick={() => copy(getFullMarkdownExport())}
                >
                  {copied ? "✓ Copied Storyboard" : "Copy Full Markdown"}
                </Button>

                <Button
                  size="sm"
                  variant="primary"
                  icon={batchGenRunning ? "progress_activity" : "photo_library"}
                  onClick={handleGenerateAllImages}
                  disabled={batchGenRunning || !imageModel || !apiKey}
                  title="Generate first-frame stills for all scenes sequentially"
                >
                  {batchGenRunning ? "Generating All Images…" : "Generate All Scene Images"}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Scenes Container */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {scenes.length === 0 ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center text-center gap-3">
              <div className="size-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-[36px]">video_library</span>
              </div>
              <h3 className="text-base font-semibold">No Storyboard Scenes Generated Yet</h3>
              <p className="text-xs text-text-muted max-w-md">
                Enter your story concept on the left, optionally upload reference image, select your Director LLM & Image Model, then click Generate to create consistent character storyboard scenes.
              </p>
            </div>
          ) : (
            <>
              {characterConsistencyPrompt && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px] mt-0.5">
                    person_check
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-primary">Character Consistency Anchor</p>
                    <p className="text-xs text-text-muted mt-0.5">{characterConsistencyPrompt}</p>
                  </div>
                  <button
                    type="button"
                    className="material-symbols-outlined text-[16px] text-text-muted hover:text-primary"
                    onClick={() => copy(characterConsistencyPrompt)}
                    title="Copy anchor"
                  >
                    content_copy
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {scenes.map((scene, idx) => {
                  const sceneNum = scene.sceneNumber || idx + 1;
                  const imgState = imageGenStates[sceneNum] || {};
                  const currentImgUrl = scene.imageUrl || imgState.assetUrl;
                  const isImgRunning = imgState.running;

                  return (
                    <div
                      key={sceneNum}
                      className="rounded-2xl border border-border bg-sidebar/30 overflow-hidden flex flex-col shadow-sm"
                    >
                      {/* Scene Header */}
                      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-sidebar/50">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-primary text-white text-[11px] font-bold">
                            Scene {sceneNum}
                          </span>
                          <span className="text-xs font-medium text-text-muted">
                            {scene.timecode || `00:${String((idx * 5)).padStart(2, '0')} - 00:${String((idx + 1) * 5).padStart(2, '0')}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-sidebar text-text-muted hover:text-primary transition"
                            onClick={() => copy(scene.motionPrompt)}
                            title="Copy Combined Motion Prompt"
                          >
                            <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          </button>
                        </div>
                      </div>

                      <div className="p-4 space-y-4 flex-1 flex flex-col">
                        {/* Summary */}
                        <div className="text-xs font-medium text-text-main bg-background/60 p-2.5 rounded-lg border border-border/50">
                          {scene.summary}
                        </div>

                        {/* First-Frame Image Preview & Generation */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs font-medium text-text-muted">
                            <span>First-Frame Still</span>
                            {idx > 0 ? (
                              <span className="text-[10px] text-amber-500 font-normal">
                                🔗 Ref: Scene {idx} Still
                              </span>
                            ) : refImage ? (
                              <span className="text-[10px] text-primary font-normal">
                                🖼️ Ref: Concept Upload
                              </span>
                            ) : null}
                          </div>

                          <div className="relative aspect-video rounded-xl border border-border bg-black/20 overflow-hidden flex items-center justify-center group">
                            {currentImgUrl ? (
                              <img
                                src={currentImgUrl}
                                alt={`Scene ${sceneNum}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-text-muted text-xs gap-1">
                                <span className="material-symbols-outlined text-[28px]">image</span>
                                <span>No initial frame yet</span>
                              </div>
                            )}

                            {isImgRunning && (
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center text-white text-xs gap-2">
                                <span className="material-symbols-outlined text-[28px] animate-spin">
                                  progress_activity
                                </span>
                                <span>Generating still...</span>
                              </div>
                            )}

                            <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                size="sm"
                                variant="secondary"
                                icon={isImgRunning ? "progress_activity" : "auto_awesome"}
                                onClick={() => handleGenerateSceneImage(scene, idx)}
                                disabled={isImgRunning || !imageModel || !apiKey}
                              >
                                {currentImgUrl ? "Regenerate Still" : "Generate Still"}
                              </Button>
                            </div>
                          </div>
                          {imgState.error && (
                            <p className="text-[11px] text-red-500">{imgState.error}</p>
                          )}
                        </div>

                        {/* 1-Text Unified Video Motion Prompt */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary flex items-center gap-1">
                              <span className="material-symbols-outlined text-[16px]">videocam</span>
                              Combined Production Prompt (1-Text Prompt)
                            </span>
                            <button
                              type="button"
                              onClick={() => copy(scene.motionPrompt)}
                              className="text-[11px] text-text-muted hover:text-primary underline"
                            >
                              Copy Prompt
                            </button>
                          </div>
                          <textarea
                            value={scene.motionPrompt || ""}
                            onChange={(e) => handleUpdateSceneField(idx, "motionPrompt", e.target.value)}
                            rows={3}
                            className="w-full rounded-xl border border-primary/30 bg-primary/5 p-2.5 text-xs outline-none focus:border-primary resize-y font-mono leading-relaxed"
                          />
                        </div>

                        {/* Image Generator Prompt */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-text-muted flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                              Image Gen Prompt
                            </span>
                            <button
                              type="button"
                              onClick={() => copy(scene.imagePrompt)}
                              className="text-[11px] text-text-muted hover:text-primary underline"
                            >
                              Copy
                            </button>
                          </div>
                          <textarea
                            value={scene.imagePrompt || ""}
                            onChange={(e) => handleUpdateSceneField(idx, "imagePrompt", e.target.value)}
                            rows={2}
                            className="w-full rounded-xl border border-border bg-background p-2 text-xs outline-none focus:border-primary resize-y font-mono"
                          />
                        </div>

                        {/* Metadata Tags Pill Grid */}
                        <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                          <div className="rounded-lg bg-background/50 border border-border p-2">
                            <span className="font-semibold text-text-muted block">Camera:</span>
                            <span className="text-text-main">{scene.camera || "-"}</span>
                          </div>
                          <div className="rounded-lg bg-background/50 border border-border p-2">
                            <span className="font-semibold text-text-muted block">Lighting:</span>
                            <span className="text-text-main">{scene.lighting || "-"}</span>
                          </div>
                          <div className="rounded-lg bg-background/50 border border-border p-2">
                            <span className="font-semibold text-text-muted block">Audio / SFX:</span>
                            <span className="text-text-main">{scene.audioSfx || "-"}</span>
                          </div>
                          <div className="rounded-lg bg-background/50 border border-border p-2">
                            <span className="font-semibold text-text-muted block">Voiceover:</span>
                            <span className="text-text-main">{scene.voiceover ? `"${scene.voiceover}"` : "None"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* LLM Model Select Modal */}
      <ModelSelectModal
        isOpen={showLlmModal}
        onClose={() => setShowLlmModal(false)}
        onSelect={(m) => setLlmModel(m?.value || m?.name || "")}
        selectedModel={llmModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Storyboard Director Model (LLM)"
      />

      {/* Image Model Select Modal */}
      <ModelSelectModal
        isOpen={showImageModal}
        onClose={() => setShowImageModal(false)}
        onSelect={(m) => setImageModel(m?.value || m?.name || "")}
        selectedModel={imageModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        kindFilter="image"
        title="Select First-Frame Image Model"
      />
    </div>
  );
}
