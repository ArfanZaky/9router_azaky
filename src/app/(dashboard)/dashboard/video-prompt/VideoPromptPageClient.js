"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button, ModelSelectModal, Modal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const STYLES = [
  { id: "cinematic", label: "Cinematic 35mm (Arri Alexa, natural film grain, anamorphic flare)" },
  { id: "photo", label: "Photorealistic 8K Documentary (ultra detailed, natural lighting)" },
  { id: "cyberpunk", label: "Cyberpunk Neon & Wet Reflections (rain, holograms, high contrast)" },
  { id: "anime", label: "Anime / Makoto Shinkai Style (vibrant sky, emotional lighting)" },
  { id: "gothic", label: "Dark Moody Gothic Fantasy (shadows, atmospheric haze, candlelight)" },
  { id: "pixar", label: "3D Animation / Pixar Character Style (stylized shaders, subsurface scattering)" },
  { id: "vintage", label: "Vintage 1970s Retro Film (Kodachrome, warm grain, lens bloom)" },
  { id: "korean_drama", label: "K-Drama / Short Drama HD (soft glamour lighting, shallow depth of field)" },
  { id: "surreal", label: "Surreal Dreamlike Fantasy (volumetric glow, floating particles)" },
];

const TARGET_ENGINES = [
  "General AI Video (Runway Gen-3 / Sora / Kling / Luma)",
  "Runway Gen-3 Alpha",
  "Kling AI (v1.5 / High Quality)",
  "Luma Dream Machine",
  "OpenAI Sora",
  "Hailuo Minimax Video-01",
  "xAI Grok Imagine Video",
  "Volcengine Seedance 2.0",
  "Pika 2.0",
];

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "2.39:1 (Anamorphic)"];
const VIDEO_DURATIONS = [5, 6, 8, 10];
const VIDEO_RESOLUTIONS = ["auto", "720p", "1080p"];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function VideoPromptPageClient() {
  // Core config & auth
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  // Active Tab
  const [activeTab, setActiveTab] = useState("story"); // 'story' | 'characters' | 'storyboard' | 'studio' | 'settings'

  // Model selection states
  const [llmModel, setLlmModel] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("xai/grok-imagine-video");
  const [showLlmModal, setShowLlmModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);

  // Studio Settings & Presets
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAspect, setVideoAspect] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("auto");
  const [directorPersona, setDirectorPersona] = useState("huobao_drama");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality, deformed, extra limbs, watermark, text overlay");

  // Storyboard Generation inputs
  const [prompt, setPrompt] = useState("");
  const [characterDesc, setCharacterDesc] = useState("");
  const [style, setStyle] = useState(STYLES[0].label);
  const [targetEngine, setTargetEngine] = useState(TARGET_ENGINES[0]);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [sceneCount, setSceneCount] = useState(4);

  // Reference image
  const [refImage, setRefImage] = useState("");
  const [refUrlDraft, setRefUrlDraft] = useState("");
  const [refDragging, setRefDragging] = useState(false);
  const refFileInputRef = useRef(null);

  // Extracted/Custom Characters
  const [characters, setCharacters] = useState([]);
  const [newCharName, setNewCharName] = useState("");
  const [newCharRole, setNewCharRole] = useState("");
  const [newCharDesc, setNewCharDesc] = useState("");

  // Storyboard Output
  const [generating, setGenerating] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [characterConsistencyPrompt, setCharacterConsistencyPrompt] = useState("");
  const [scenes, setScenes] = useState([]);
  const [error, setError] = useState("");

  // Projects / History
  const [projects, setProjects] = useState([]);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Generation state tracking
  const [imageGenStates, setImageGenStates] = useState({});
  const [batchGenRunning, setBatchGenRunning] = useState(false);
  const [videoGenStates, setVideoGenStates] = useState({});
  const [batchVideoRunning, setBatchVideoRunning] = useState(false);

  // Active scene selection for studio preview
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);

  // Quick settings modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const { copied, copy } = useCopyToClipboard(2000);

  // Load initial environment data
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

  const persistScenes = (nextScenes) => {
    setScenes(nextScenes);
    if (currentProjectId) {
      fetch(`/api/video-prompt/projects/${currentProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: nextScenes }),
      })
        .then(() => loadProjects())
        .catch(() => {});
    }
  };

  // Manual save project
  const handleSaveProject = async () => {
    if (!prompt.trim() && (!scenes || scenes.length === 0)) {
      setError("Cannot save empty project. Please enter a prompt or generate scenes.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        title: projectTitle || "Untitled Storyboard",
        prompt: prompt.trim(),
        llmModel,
        imageModel,
        videoModel,
        style,
        targetEngine,
        characterDesc,
        refImage: refImage || "",
        scenes,
      };

      if (currentProjectId) {
        await fetch(`/api/video-prompt/projects/${currentProjectId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const res = await fetch("/api/video-prompt/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (data.project?.id) {
          setCurrentProjectId(data.project.id);
        }
      }
      await loadProjects();
    } catch (e) {
      console.error("Save error", e);
    } finally {
      setIsSaving(false);
    }
  };

  // Add character
  const handleAddCharacter = () => {
    if (!newCharName.trim()) return;
    const char = {
      id: Date.now().toString(),
      name: newCharName.trim(),
      role: newCharRole.trim() || "Lead",
      description: newCharDesc.trim(),
      tags: [],
    };
    setCharacters([...characters, char]);
    setNewCharName("");
    setNewCharRole("");
    setNewCharDesc("");
  };

  const handleDeleteCharacter = (id) => {
    setCharacters(characters.filter((c) => c.id !== id));
  };

  // Generate Storyboard API
  const handleGenerateStoryboard = async () => {
    if (!prompt.trim()) {
      setError("Please enter a story concept or script");
      return;
    }
    if (!llmModel) {
      setError("Please select an LLM model in settings or top bar");
      return;
    }

    setGenerating(true);
    setError("");
    try {
      // Build composite character prompt
      let combinedCharacterDesc = characterDesc.trim();
      if (characters.length > 0) {
        const charListStr = characters
          .map((c) => `[${c.name} - ${c.role}]: ${c.description}`)
          .join(" | ");
        combinedCharacterDesc = combinedCharacterDesc
          ? `${combinedCharacterDesc}\nStructured Characters: ${charListStr}`
          : `Structured Characters: ${charListStr}`;
      }

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
          characterDesc: combinedCharacterDesc,
          refImage: refImage || undefined,
          directorPersona,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate video storyboard");
      }

      setProjectTitle(data.projectTitle || "Generated Drama Storyboard");
      setCharacterConsistencyPrompt(data.characterConsistencyPrompt || "");
      const generatedScenes = (data.scenes || []).map((s, idx) => ({
        ...s,
        sceneNumber: s.sceneNumber || idx + 1,
        imageStatus: "idle",
        imageUrl: "",
        videoUrl: "",
        videoStatus: "idle",
      }));
      setScenes(generatedScenes);
      setSelectedSceneIndex(0);

      // Auto switch to storyboard tab
      setActiveTab("storyboard");

      const saveRes = await fetch("/api/video-prompt/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: data.projectTitle || "Untitled Storyboard",
          prompt: prompt.trim(),
          llmModel,
          imageModel,
          videoModel,
          style,
          targetEngine,
          characterDesc: combinedCharacterDesc,
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

  // Generate First-Frame Image
  const handleGenerateImage = async (sceneIndex) => {
    const targetScene = scenes[sceneIndex];
    if (!targetScene) return;

    if (!imageModel) {
      setError("Please select an Image Generation Model first (in Studio / Settings)");
      return;
    }

    setImageGenStates((prev) => ({ ...prev, [sceneIndex]: { loading: true, error: "" } }));
    setError("");

    try {
      const fullPrompt = `${targetScene.imagePrompt}. Consistent Style: ${characterConsistencyPrompt || style}`;
      const res = await fetch("/api/video-prompt/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: fullPrompt,
          model: imageModel,
          aspectRatio,
          apiKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Image generation failed");
      }

      const nextScenes = [...scenes];
      nextScenes[sceneIndex] = {
        ...nextScenes[sceneIndex],
        imageUrl: data.imageUrl,
        imageStatus: "ready",
      };
      persistScenes(nextScenes);
      setImageGenStates((prev) => ({ ...prev, [sceneIndex]: { loading: false, error: "" } }));
    } catch (err) {
      setImageGenStates((prev) => ({
        ...prev,
        [sceneIndex]: { loading: false, error: err.message },
      }));
    }
  };

  // Generate Video Clip
  const handleGenerateVideo = async (sceneIndex) => {
    const targetScene = scenes[sceneIndex];
    if (!targetScene) return;

    if (!videoModel) {
      setError("Please select a Video Generation Model first (e.g. xai/grok-imagine-video)");
      return;
    }

    setVideoGenStates((prev) => ({ ...prev, [sceneIndex]: { status: "submitting", error: "" } }));
    setError("");

    try {
      const res = await fetch("/api/video-prompt/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: videoModel,
          prompt: targetScene.motionPrompt || targetScene.summary,
          image: targetScene.imageUrl || undefined,
          duration: videoDuration,
          aspectRatio: videoAspect,
          resolution: videoResolution,
          apiKey,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Video dispatch failed");
      }

      const requestId = data.requestId;
      const connectionId = data.connectionId;

      if (!requestId && data.videoUrl) {
        const nextScenes = [...scenes];
        nextScenes[sceneIndex] = {
          ...nextScenes[sceneIndex],
          videoUrl: data.videoUrl,
          videoStatus: "completed",
        };
        persistScenes(nextScenes);
        setVideoGenStates((prev) => ({ ...prev, [sceneIndex]: { status: "completed", error: "" } }));
        return;
      }

      setVideoGenStates((prev) => ({
        ...prev,
        [sceneIndex]: { status: "processing", requestId, connectionId, error: "" },
      }));

      // Poll video progress
      const pollInterval = setInterval(async () => {
        try {
          const pollUrl = `/api/video-prompt/generate-video?requestId=${encodeURIComponent(
            requestId
          )}&apiKey=${encodeURIComponent(apiKey)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`;

          const pollRes = await fetch(pollUrl);
          const pollData = await pollRes.json().catch(() => ({}));

          if (pollData.status === "completed" && pollData.videoUrl) {
            clearInterval(pollInterval);
            const nextScenes = [...scenes];
            nextScenes[sceneIndex] = {
              ...nextScenes[sceneIndex],
              videoUrl: pollData.videoUrl,
              videoStatus: "completed",
            };
            persistScenes(nextScenes);
            setVideoGenStates((prev) => ({ ...prev, [sceneIndex]: { status: "completed", error: "" } }));
          } else if (pollData.status === "failed") {
            clearInterval(pollInterval);
            setVideoGenStates((prev) => ({
              ...prev,
              [sceneIndex]: { status: "failed", error: pollData.error || "Video rendering failed" },
            }));
          }
        } catch (pollErr) {
          console.error("Poll error", pollErr);
        }
      }, 4000);
    } catch (err) {
      setVideoGenStates((prev) => ({
        ...prev,
        [sceneIndex]: { status: "failed", error: err.message },
      }));
    }
  };

  // Batch Image Gen
  const handleBatchGenerateImages = async () => {
    if (!imageModel) {
      setError("Please select an Image Model first");
      return;
    }
    setBatchGenRunning(true);
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i].imageUrl) {
        await handleGenerateImage(i);
      }
    }
    setBatchGenRunning(false);
  };

  // Batch Video Gen
  const handleBatchGenerateVideos = async () => {
    if (!videoModel) {
      setError("Please select a Video Model first");
      return;
    }
    setBatchVideoRunning(true);
    for (let i = 0; i < scenes.length; i++) {
      if (!scenes[i].videoUrl) {
        await handleGenerateVideo(i);
      }
    }
    setBatchVideoRunning(false);
  };

  // Load project from history
  const handleSelectProject = async (p) => {
    setCurrentProjectId(p.id);
    setProjectTitle(p.title || "");
    setPrompt(p.prompt || "");
    setLlmModel(p.llmModel || "");
    setImageModel(p.imageModel || "");
    setVideoModel(p.videoModel || "xai/grok-imagine-video");
    setStyle(p.style || STYLES[0].label);
    setTargetEngine(p.targetEngine || TARGET_ENGINES[0]);
    setCharacterDesc(p.characterDesc || "");
    setRefImage(p.refImage || "");
    setScenes(p.scenes || []);
    setHistoryOpen(false);
  };

  const handleDeleteProject = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this storyboard project?")) return;
    try {
      await fetch(`/api/video-prompt/projects/${id}`, { method: "DELETE" });
      await loadProjects();
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        setScenes([]);
        setProjectTitle("");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Format full exported script/prompts
  const exportFullScript = () => {
    let output = `# ${projectTitle || "Huobao Short Drama Storyboard"}\n\n`;
    output += `**Visual Style:** ${style}\n`;
    output += `**Target Engine:** ${targetEngine}\n`;
    output += `**Aspect Ratio:** ${aspectRatio}\n`;
    if (characterConsistencyPrompt) {
      output += `\n### Character Consistency Prompt\n${characterConsistencyPrompt}\n`;
    }
    output += `\n---\n\n## Scene Breakdown\n\n`;

    scenes.forEach((s, idx) => {
      output += `### Scene ${s.sceneNumber || idx + 1} (${s.timecode || "00:00"})\n`;
      output += `**Action Summary:** ${s.summary}\n\n`;
      output += `**First Frame Prompt (Image):**\n\`\`\`\n${s.imagePrompt}\n\`\`\`\n\n`;
      output += `**Video Motion Prompt:**\n\`\`\`\n${s.motionPrompt}\n\`\`\`\n\n`;
      if (s.camera) output += `- **Camera:** ${s.camera}\n`;
      if (s.lighting) output += `- **Lighting:** ${s.lighting}\n`;
      if (s.audioSfx) output += `- **Audio/SFX:** ${s.audioSfx}\n`;
      if (s.voiceover) output += `- **Dialogue/VO:** ${s.voiceover}\n`;
      output += `\n---\n\n`;
    });

    return output;
  };

  const filteredProjects = useMemo(() => {
    if (!searchHistory.trim()) return projects;
    const q = searchHistory.toLowerCase();
    return projects.filter(
      (p) =>
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.prompt && p.prompt.toLowerCase().includes(q))
    );
  }, [projects, searchHistory]);

  const activeScene = scenes[selectedSceneIndex] || scenes[0];

  return (
    <div className="flex flex-1 flex-col min-h-0 h-full w-full overflow-hidden bg-background text-text-main">
      {/* Top Navigation Bar: Huobao Drama Pipeline Tabs & Actions */}
      <header className="h-14 border-b border-border bg-card/60 backdrop-blur-sm px-4 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-bold">
            <span className="material-symbols-outlined text-[20px]">movie_filter</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight">Huobao Video Drama Studio</h1>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/15 text-primary border border-primary/25">
                Pipeline 3.0
              </span>
            </div>
            <p className="text-[11px] text-text-muted truncate max-w-[280px]">
              {projectTitle || "Script → Character → Storyboard → Video Production"}
            </p>
          </div>
        </div>

        {/* Workflow Tabs */}
        <div className="hidden md:flex items-center bg-muted/60 p-1 rounded-lg border border-border/80">
          <button
            onClick={() => setActiveTab("story")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "story"
                ? "bg-card text-text-main shadow-xs border border-border"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">menu_book</span>
            1. Script & Story
          </button>
          <button
            onClick={() => setActiveTab("characters")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "characters"
                ? "bg-card text-text-main shadow-xs border border-border"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">groups</span>
            2. Characters ({characters.length})
          </button>
          <button
            onClick={() => setActiveTab("storyboard")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "storyboard"
                ? "bg-card text-text-main shadow-xs border border-border"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">grid_view</span>
            3. Storyboard ({scenes.length})
          </button>
          <button
            onClick={() => setActiveTab("studio")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "studio"
                ? "bg-card text-text-main shadow-xs border border-border"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">videocam</span>
            4. Video Studio
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === "settings"
                ? "bg-card text-text-main shadow-xs border border-border"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
            5. Settings GUI
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {(scenes.length > 0 || prompt.trim()) && (
            <Button
              variant="outline"
              size="sm"
              icon="save"
              loading={isSaving}
              onClick={handleSaveProject}
              className="text-xs"
              title="Save project"
            >
              Save
            </Button>
          )}

          {scenes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              icon={copied ? "check" : "content_copy"}
              onClick={() => copy(exportFullScript())}
              className="text-xs"
            >
              {copied ? "Copied Script" : "Export Script"}
            </Button>
          )}

          <Button
            variant={historyOpen ? "primary" : "ghost"}
            size="sm"
            icon="history"
            onClick={() => {
              setHistoryOpen(!historyOpen);
              loadProjects();
            }}
            className="text-xs"
            title="Saved Storyboards"
          >
            History ({projects.length})
          </Button>

          <Button
            variant="outline"
            size="sm"
            icon="tune"
            onClick={() => setShowSettingsModal(true)}
            className="text-xs"
            title="Configure Models"
          >
            Model GUI
          </Button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex flex-1 min-h-0 h-full overflow-hidden relative">
        {/* TAB 1: SCRIPT & STORY INPUT */}
        {activeTab === "story" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-6 justify-center">
            <div className="max-w-4xl w-full space-y-6">
              {/* Header card */}
              <div className="p-5 rounded-xl bg-card border border-border/80 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">auto_fix_high</span>
                    <h2 className="text-base font-semibold">Short Drama Script & Concept</h2>
                  </div>
                  <span className="text-xs text-text-muted">Step 1: Input raw novel / story arc</span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-muted">
                    Story Concept / Novel Excerpt / Drama Outline *
                  </label>
                  <textarea
                    rows={6}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter your novel excerpt, short drama script, or storyline here... e.g.: A high-stakes corporate betrayal in Neo Tokyo where a rookie detective uncovers a conspiracy connecting the CEO with underground cybernetic syndicates."
                    className="w-full text-sm bg-muted/40 border border-border rounded-lg p-3 outline-none focus:border-primary transition-colors resize-y placeholder:text-text-muted/60"
                  />
                </div>

                {/* Main Settings Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {/* Style selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">palette</span> Visual Style Preset
                    </label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer text-text-main"
                    >
                      {STYLES.map((s) => (
                        <option key={s.id} value={s.label}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Target Video Platform */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">smart_display</span> Target Video Engine
                    </label>
                    <select
                      value={targetEngine}
                      onChange={(e) => setTargetEngine(e.target.value)}
                      className="w-full text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 outline-none focus:border-primary cursor-pointer text-text-main"
                    >
                      {TARGET_ENGINES.map((eng) => (
                        <option key={eng} value={eng}>
                          {eng}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Scene Count */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">movie</span> Scene Count ({sceneCount} shots)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="2"
                        max="12"
                        value={sceneCount}
                        onChange={(e) => setSceneCount(Number(e.target.value))}
                        className="flex-1 accent-primary cursor-pointer"
                      />
                      <span className="text-xs font-semibold px-2 py-1 bg-muted rounded border border-border w-10 text-center">
                        {sceneCount}
                      </span>
                    </div>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">aspect_ratio</span> Aspect Ratio
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {ASPECT_RATIOS.map((ratio) => (
                        <button
                          key={ratio}
                          type="button"
                          onClick={() => setAspectRatio(ratio)}
                          className={`px-2 py-1.5 text-xs rounded-md border font-medium transition-colors ${
                            aspectRatio === ratio
                              ? "bg-primary text-white border-primary"
                              : "bg-muted/40 border-border hover:bg-muted"
                          }`}
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Reference Portrait / Visual anchor */}
                <div className="space-y-2 pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px]">face</span> Reference Character / Keyframe Image
                    </label>
                    {refImage && (
                      <button
                        onClick={clearRefImage}
                        className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span> Clear Image
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col md:flex-row gap-4 items-center">
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setRefDragging(true);
                      }}
                      onDragLeave={() => setRefDragging(false)}
                      onDrop={handleRefDrop}
                      onClick={() => refFileInputRef.current?.click()}
                      className={`flex-1 w-full h-24 border-2 border-dashed rounded-lg flex items-center justify-center p-3 cursor-pointer transition-colors ${
                        refDragging
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50 bg-muted/20"
                      }`}
                    >
                      <input
                        ref={refFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleRefFile}
                        className="hidden"
                      />
                      <div className="text-center">
                        <span className="material-symbols-outlined text-text-muted text-[24px]">cloud_upload</span>
                        <p className="text-xs text-text-muted mt-1">
                          Drag & drop reference face / keyframe image, or click to upload
                        </p>
                      </div>
                    </div>

                    {refImage && (
                      <div className="relative h-24 w-24 rounded-lg overflow-hidden border border-border bg-black/40 shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={refImage} alt="Ref preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Action CTA */}
                <div className="pt-4 flex items-center justify-between border-t border-border/60">
                  <div className="text-xs text-text-muted">
                    Active LLM: <span className="text-primary font-medium">{llmModel || "None (Select below)"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLlmModal(true)}
                    >
                      Change LLM Model
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      icon="auto_fix_high"
                      loading={generating}
                      onClick={handleGenerateStoryboard}
                      disabled={generating}
                    >
                      Generate Storyboard Pipeline
                    </Button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">error</span>
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CHARACTERS & ASSETS */}
        {activeTab === "characters" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-6 justify-center">
            <div className="max-w-4xl w-full space-y-6">
              <div className="p-5 rounded-xl bg-card border border-border shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">groups</span>
                      Character & Asset Extractor
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Define persistent visual traits, wardrobe, and actor seeds across shots
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="add"
                    onClick={handleAddCharacter}
                  >
                    Add Character
                  </Button>
                </div>

                {/* Add new character form */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3.5 rounded-lg bg-muted/40 border border-border">
                  <div>
                    <label className="text-[11px] font-medium text-text-muted">Character Name</label>
                    <input
                      type="text"
                      value={newCharName}
                      onChange={(e) => setNewCharName(e.target.value)}
                      placeholder="e.g. Jack Vance"
                      className="w-full mt-1 text-xs bg-card border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-text-muted">Role / Archetype</label>
                    <input
                      type="text"
                      value={newCharRole}
                      onChange={(e) => setNewCharRole(e.target.value)}
                      placeholder="e.g. Cybernetic Detective"
                      className="w-full mt-1 text-xs bg-card border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-text-muted">Visual Description / Wardrobe</label>
                    <input
                      type="text"
                      value={newCharDesc}
                      onChange={(e) => setNewCharDesc(e.target.value)}
                      placeholder="e.g. 35yo, worn brown trench coat, glowing blue cybernetic eye"
                      className="w-full mt-1 text-xs bg-card border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
                    />
                  </div>
                </div>

                {/* Character List Grid */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Active Cast & Consistency Anchors ({characters.length})
                  </h3>

                  {characters.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-border rounded-xl text-text-muted text-xs">
                      <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">person_search</span>
                      <p>No custom characters defined yet.</p>
                      <p className="text-[11px] mt-1 text-text-muted/70">
                        Add key characters above or let the Storyboard Generator extract them automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {characters.map((char) => (
                        <div
                          key={char.id}
                          className="p-4 rounded-lg bg-muted/20 border border-border/80 hover:border-primary/50 transition-colors space-y-2 relative group"
                        >
                          <button
                            onClick={() => handleDeleteCharacter(char.id)}
                            className="absolute top-3 right-3 text-text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete character"
                          >
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
                              {char.name[0]?.toUpperCase()}
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold">{char.name}</h4>
                              <span className="text-[10px] text-primary">{char.role}</span>
                            </div>
                          </div>
                          <p className="text-xs text-text-muted line-clamp-3">{char.description || "No visual details specified."}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Global Character Consistency Prompt */}
                <div className="space-y-2 pt-4 border-t border-border/60">
                  <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px]">lock_reset</span> Global Character Consistency Rules
                  </label>
                  <textarea
                    rows={3}
                    value={characterConsistencyPrompt}
                    onChange={(e) => setCharacterConsistencyPrompt(e.target.value)}
                    placeholder="Global prompt injected into every scene to maintain visual style, actor facial features, lighting, and wardrobe..."
                    className="w-full text-xs bg-muted/40 border border-border rounded-lg p-2.5 outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: STORYBOARD BREAKDOWN (SCENE LIST & DETAILS) */}
        {activeTab === "storyboard" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Storyboard List & Grid */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">grid_view</span>
                    {projectTitle || "Generated Storyboard Scenes"}
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    {scenes.length} Shots • Style: {style} • Target: {targetEngine}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon="image"
                    onClick={handleBatchGenerateImages}
                    loading={batchGenRunning}
                    disabled={batchGenRunning || scenes.length === 0}
                  >
                    Batch Gen Images
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="movie"
                    onClick={handleBatchGenerateVideos}
                    loading={batchVideoRunning}
                    disabled={batchVideoRunning || scenes.length === 0}
                  >
                    Batch Gen Videos
                  </Button>
                </div>
              </div>

              {scenes.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-border rounded-xl text-text-muted text-xs">
                  <span className="material-symbols-outlined text-[40px] mb-2 opacity-40">movie_edit</span>
                  <p className="text-sm font-medium">No Storyboard Generated Yet</p>
                  <p className="text-xs mt-1 text-text-muted/70 max-w-sm mx-auto">
                    Go to Tab 1 (Script & Story), enter your story outline, and click Generate Storyboard.
                  </p>
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => setActiveTab("story")}>
                      Go to Story Input
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
                  {scenes.map((scene, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedSceneIndex(idx);
                        setActiveTab("studio");
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        selectedSceneIndex === idx
                          ? "bg-card border-primary/60 shadow-md ring-1 ring-primary/30"
                          : "bg-card/70 border-border/80 hover:border-primary/40 hover:bg-card"
                      }`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                              Shot #{scene.sceneNumber || idx + 1}
                            </span>
                            <span className="text-[11px] text-text-muted">{scene.timecode || `00:${idx * 5}s`}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {scene.imageUrl && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 font-medium">
                                Image Ready
                              </span>
                            )}
                            {scene.videoUrl && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/15 text-blue-500 border border-blue-500/20 font-medium">
                                Video Ready
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Image / Video preview thumbnail */}
                        <div className="aspect-video w-full rounded-lg bg-muted/40 border border-border overflow-hidden relative group">
                          {scene.videoUrl ? (
                            <video src={scene.videoUrl} className="w-full h-full object-cover" muted autoPlay loop />
                          ) : scene.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={scene.imageUrl} alt={`Scene ${idx + 1}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-text-muted/60">
                              <span className="material-symbols-outlined text-[28px]">image</span>
                              <span className="text-[10px] mt-1">No preview generated</span>
                            </div>
                          )}
                        </div>

                        <p className="text-xs font-medium text-text-main line-clamp-2">{scene.summary}</p>

                        {/* Motion prompt snippet */}
                        <div className="p-2 rounded bg-muted/40 border border-border/60 text-[11px] text-text-muted line-clamp-2 font-mono">
                          {scene.motionPrompt}
                        </div>
                      </div>

                      <div className="pt-3 mt-2 border-t border-border/60 flex items-center justify-between text-xs">
                        <span className="text-[11px] text-text-muted flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">videocam</span>
                          {scene.camera || "Dynamic"}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          icon="arrow_forward"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSceneIndex(idx);
                            setActiveTab("studio");
                          }}
                        >
                          Open in Studio
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: VIDEO STUDIO & MEDIA GENERATOR */}
        {activeTab === "studio" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left scene selector strip */}
            <div className="w-64 border-r border-border bg-muted/10 overflow-y-auto custom-scrollbar p-3 space-y-2 shrink-0">
              <div className="text-[11px] font-semibold text-text-muted uppercase px-2 tracking-wider">
                Scene Timeline ({scenes.length})
              </div>

              {scenes.map((sc, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedSceneIndex(idx)}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                    selectedSceneIndex === idx
                      ? "bg-card border-primary text-text-main shadow-xs"
                      : "bg-card/40 border-border/70 text-text-muted hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-text-main">Shot #{sc.sceneNumber || idx + 1}</span>
                    <span className="text-[10px]">{sc.timecode || `${idx * 5}s`}</span>
                  </div>
                  <p className="text-[11px] truncate mt-1 text-text-muted">{sc.summary}</p>
                </div>
              ))}
            </div>

            {/* Right main editing canvas */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
              {activeScene ? (
                <div className="max-w-4xl space-y-6">
                  {/* Scene Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">videocam</span>
                        Shot #{activeScene.sceneNumber || selectedSceneIndex + 1}: {activeScene.summary}
                      </h2>
                      <p className="text-xs text-text-muted mt-0.5">
                        Camera: {activeScene.camera || "35mm Anamorphic"} • Lighting: {activeScene.lighting || "Natural"}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        icon="content_copy"
                        onClick={() => copy(activeScene.motionPrompt)}
                      >
                        Copy Video Prompt
                      </Button>
                    </div>
                  </div>

                  {/* Dual Preview Box (First-frame image & Generated Video) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* First frame Image Box */}
                    <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-primary text-[16px]">image</span>
                          First-Frame Keyframe Image
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">{imageModel || "No model set"}</span>
                      </div>

                      <div className="aspect-video rounded-lg bg-muted/40 border border-border overflow-hidden relative flex items-center justify-center">
                        {activeScene.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={activeScene.imageUrl} alt="First frame" className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center text-text-muted/60">
                            <span className="material-symbols-outlined text-[32px]">image_search</span>
                            <p className="text-xs mt-1">First-frame not rendered yet</p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShowImageModal(true)}
                        >
                          Select Image Model
                        </Button>

                        <Button
                          variant="primary"
                          size="sm"
                          icon="draw"
                          loading={imageGenStates[selectedSceneIndex]?.loading}
                          onClick={() => handleGenerateImage(selectedSceneIndex)}
                        >
                          Generate Image
                        </Button>
                      </div>
                    </div>

                    {/* AI Video Generation Box */}
                    <div className="p-4 rounded-xl bg-card border border-border shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-primary text-[16px]">movie</span>
                          AI Video Generation
                        </span>
                        <span className="text-[11px] text-text-muted font-mono">{videoModel || "No model set"}</span>
                      </div>

                      <div className="aspect-video rounded-lg bg-black/60 border border-border overflow-hidden relative flex items-center justify-center">
                        {activeScene.videoUrl ? (
                          <video src={activeScene.videoUrl} controls className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center text-text-muted/60 p-4">
                            <span className="material-symbols-outlined text-[32px]">videocam_off</span>
                            <p className="text-xs mt-1">Video not rendered yet</p>
                            {videoGenStates[selectedSceneIndex]?.status === "processing" && (
                              <p className="text-xs text-primary font-medium mt-1 animate-pulse">
                                Rendering video on AI cluster...
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setShowVideoModal(true)}
                        >
                          Select Video Model
                        </Button>

                        <Button
                          variant="primary"
                          size="sm"
                          icon="play_arrow"
                          loading={videoGenStates[selectedSceneIndex]?.status === "processing" || videoGenStates[selectedSceneIndex]?.status === "submitting"}
                          onClick={() => handleGenerateVideo(selectedSceneIndex)}
                        >
                          Generate Video
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Prompt Editors for Current Scene */}
                  <div className="p-4 rounded-xl bg-card border border-border space-y-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Prompt Engineering Details
                    </h3>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">First-Frame Image Generation Prompt</label>
                      <textarea
                        rows={3}
                        value={activeScene.imagePrompt}
                        onChange={(e) => {
                          const next = [...scenes];
                          next[selectedSceneIndex].imagePrompt = e.target.value;
                          persistScenes(next);
                        }}
                        className="w-full text-xs font-mono bg-muted/40 border border-border rounded-lg p-2.5 outline-none focus:border-primary"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Video Motion & Camera Prompt</label>
                      <textarea
                        rows={3}
                        value={activeScene.motionPrompt}
                        onChange={(e) => {
                          const next = [...scenes];
                          next[selectedSceneIndex].motionPrompt = e.target.value;
                          persistScenes(next);
                        }}
                        className="w-full text-xs font-mono bg-muted/40 border border-border rounded-lg p-2.5 outline-none focus:border-primary"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                      <div>
                        <label className="text-[11px] font-medium text-text-muted">Audio / SFX</label>
                        <input
                          type="text"
                          value={activeScene.audioSfx || ""}
                          onChange={(e) => {
                            const next = [...scenes];
                            next[selectedSceneIndex].audioSfx = e.target.value;
                            persistScenes(next);
                          }}
                          className="w-full mt-1 text-xs bg-muted/40 border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-text-muted">Dialogue / Voiceover</label>
                        <input
                          type="text"
                          value={activeScene.voiceover || ""}
                          onChange={(e) => {
                            const next = [...scenes];
                            next[selectedSceneIndex].voiceover = e.target.value;
                            persistScenes(next);
                          }}
                          className="w-full mt-1 text-xs bg-muted/40 border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-text-muted text-xs">
                  Select a shot from the left timeline to edit.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS GUI (FULL CONFIGURATOR) */}
        {activeTab === "settings" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-6 justify-center">
            <div className="max-w-4xl w-full space-y-6">
              <div className="p-5 rounded-xl bg-card border border-border shadow-sm space-y-5">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">tune</span>
                    AI Model & Video Generation Settings
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    Configure LLM, image generator, video render engine, and prompt engineering parameters
                  </p>
                </div>

                {/* Model Selectors Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* LLM Model */}
                  <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-2">
                    <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-[16px]">psychology</span>
                      Script & Story LLM
                    </label>
                    <p className="text-[11px] text-text-muted">Extracts characters and splits storyboard</p>
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-between text-xs"
                        onClick={() => setShowLlmModal(true)}
                      >
                        <span className="truncate">{llmModel || "Select LLM Model..."}</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_drop_down</span>
                      </Button>
                    </div>
                  </div>

                  {/* Image Gen Model */}
                  <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-2">
                    <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-[16px]">image</span>
                      First-Frame Image Model
                    </label>
                    <p className="text-[11px] text-text-muted">Generates keyframe image for each shot</p>
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-between text-xs"
                        onClick={() => setShowImageModal(true)}
                      >
                        <span className="truncate">{imageModel || "Select Image Model..."}</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_drop_down</span>
                      </Button>
                    </div>
                  </div>

                  {/* Video Gen Model */}
                  <div className="p-3.5 rounded-lg bg-muted/30 border border-border space-y-2">
                    <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-[16px]">movie</span>
                      AI Video Model
                    </label>
                    <p className="text-[11px] text-text-muted">Renders motion video clips</p>
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-between text-xs"
                        onClick={() => setShowVideoModal(true)}
                      >
                        <span className="truncate">{videoModel || "Select Video Model..."}</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_drop_down</span>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Video Generation Parameters */}
                <div className="space-y-3 pt-4 border-t border-border/60">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Render Configuration
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Duration */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Default Clip Duration</label>
                      <div className="flex gap-2">
                        {VIDEO_DURATIONS.map((dur) => (
                          <button
                            key={dur}
                            type="button"
                            onClick={() => setVideoDuration(dur)}
                            className={`flex-1 py-1.5 text-xs rounded border font-medium ${
                              videoDuration === dur
                                ? "bg-primary text-white border-primary"
                                : "bg-muted/40 border-border"
                            }`}
                          >
                            {dur}s
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Video Resolution */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Resolution</label>
                      <div className="flex gap-2">
                        {VIDEO_RESOLUTIONS.map((res) => (
                          <button
                            key={res}
                            type="button"
                            onClick={() => setVideoResolution(res)}
                            className={`flex-1 py-1.5 text-xs rounded border font-medium capitalize ${
                              videoResolution === res
                                ? "bg-primary text-white border-primary"
                                : "bg-muted/40 border-border"
                            }`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Aspect */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Video Aspect Ratio</label>
                      <select
                        value={videoAspect}
                        onChange={(e) => setVideoAspect(e.target.value)}
                        className="w-full text-xs bg-muted/40 border border-border rounded px-3 py-1.5 outline-none focus:border-primary"
                      >
                        <option value="16:9">16:9 (Landscape HD)</option>
                        <option value="9:16">9:16 (Vertical Short)</option>
                        <option value="1:1">1:1 (Square)</option>
                        <option value="21:9">21:9 (Cinematic Ultrawide)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Negative Prompt */}
                <div className="space-y-1.5 pt-3 border-t border-border/60">
                  <label className="text-xs font-medium text-text-muted">Negative Prompt (Image & Video)</label>
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="w-full text-xs bg-muted/40 border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Projects Drawer / Sidebar */}
        {historyOpen && (
          <aside className="w-80 border-l border-border bg-card/95 backdrop-blur-sm p-4 flex flex-col justify-between shrink-0 z-20">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Saved Storyboards ({projects.length})
                </h3>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <input
                type="text"
                placeholder="Search history..."
                value={searchHistory}
                onChange={(e) => setSearchHistory(e.target.value)}
                className="w-full text-xs bg-muted/50 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-primary"
              />

              <div className="space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-6 text-xs text-text-muted">No projects found</div>
                ) : (
                  filteredProjects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectProject(p)}
                      className={`p-3 rounded-lg border text-left cursor-pointer transition-colors relative group ${
                        currentProjectId === p.id
                          ? "bg-primary/10 border-primary/50 text-text-main"
                          : "bg-muted/20 border-border hover:border-primary/40 text-text-muted hover:text-text-main"
                      }`}
                    >
                      <button
                        onClick={(e) => handleDeleteProject(e, p.id)}
                        className="absolute top-2 right-2 text-text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete project"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                      <h4 className="text-xs font-semibold truncate pr-4 text-text-main">
                        {p.title || "Untitled Storyboard"}
                      </h4>
                      <p className="text-[11px] text-text-muted line-clamp-2 mt-1">{p.prompt}</p>
                      <div className="flex items-center justify-between text-[10px] text-text-muted mt-2">
                        <span>{p.scenes?.length || 0} scenes</span>
                        <span>{new Date(p.updatedAt || p.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Model Selection Modals */}
      <ModelSelectModal
        isOpen={showLlmModal}
        onClose={() => setShowLlmModal(false)}
        onSelect={(m) => {
          const modelVal = m?.value || m?.name || m;
          setLlmModel(modelVal);
          setShowLlmModal(false);
        }}
        selectedModel={llmModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Script LLM Model"
      />

      <ModelSelectModal
        isOpen={showImageModal}
        onClose={() => setShowImageModal(false)}
        onSelect={(m) => {
          const modelVal = m?.value || m?.name || m;
          setImageModel(modelVal);
          setShowImageModal(false);
        }}
        selectedModel={imageModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        kindFilter="image"
        title="Select First-Frame Image Model"
      />

      <ModelSelectModal
        isOpen={showVideoModal}
        onClose={() => setShowVideoModal(false)}
        onSelect={(m) => {
          const modelVal = m?.value || m?.name || m;
          setVideoModel(modelVal);
          setShowVideoModal(false);
        }}
        selectedModel={videoModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select AI Video Generation Model"
      />

      {/* Settings Modal Shortcut */}
      <Modal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="Quick Model Configuration"
      >
        <div className="space-y-4 py-2 text-xs">
          <div>
            <label className="font-semibold block mb-1">LLM Model (Story / Script)</label>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between"
              onClick={() => {
                setShowSettingsModal(false);
                setShowLlmModal(true);
              }}
            >
              <span>{llmModel || "Select Model..."}</span>
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </Button>
          </div>

          <div>
            <label className="font-semibold block mb-1">Image Model (First-Frame Synthesis)</label>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between"
              onClick={() => {
                setShowSettingsModal(false);
                setShowImageModal(true);
              }}
            >
              <span>{imageModel || "Select Model..."}</span>
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </Button>
          </div>

          <div>
            <label className="font-semibold block mb-1">Video Model (AI Video Engine)</label>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-between"
              onClick={() => {
                setShowSettingsModal(false);
                setShowVideoModal(true);
              }}
            >
              <span>{videoModel || "Select Model..."}</span>
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
