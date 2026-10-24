"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button, ModelSelectModal, Modal, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const STYLES = [
  { id: "cinematic", label: "Cinematic 35mm (Arri Alexa, natural film grain, anamorphic flare)", tag: "35mm Film" },
  { id: "photo", label: "Photorealistic 8K Documentary (ultra detailed, natural lighting)", tag: "8K Photo" },
  { id: "cyberpunk", label: "Cyberpunk Neon & Wet Reflections (rain, holograms, high contrast)", tag: "Cyberpunk" },
  { id: "anime", label: "Anime / Makoto Shinkai Style (vibrant sky, emotional lighting)", tag: "Anime" },
  { id: "gothic", label: "Dark Moody Gothic Fantasy (shadows, atmospheric haze, candlelight)", tag: "Gothic" },
  { id: "pixar", label: "3D Animation / Pixar Character Style (stylized shaders, subsurface scattering)", tag: "3D Pixar" },
  { id: "vintage", label: "Vintage 1970s Retro Film (Kodachrome, warm grain, lens bloom)", tag: "1970s Retro" },
  { id: "korean_drama", label: "K-Drama / Short Drama HD (soft glamour lighting, shallow depth of field)", tag: "K-Drama" },
  { id: "surreal", label: "Surreal Dreamlike Fantasy (volumetric glow, floating particles)", tag: "Surreal" },
];

const TARGET_ENGINES = [
  { name: "General AI Video (Runway Gen-3 / Sora / Kling / Luma)", short: "General Video", badge: "Universal" },
  { name: "Runway Gen-3 Alpha", short: "Runway Gen-3", badge: "Motion Brush" },
  { name: "Kling AI (v1.5 / High Quality)", short: "Kling AI 1.5", badge: "Kinetic" },
  { name: "Luma Dream Machine", short: "Luma Dream", badge: "Smooth Cam" },
  { name: "OpenAI Sora", short: "OpenAI Sora", badge: "High Res" },
  { name: "Hailuo Minimax Video-01", short: "Hailuo Minimax", badge: "Cinematic" },
  { name: "xAI Grok Imagine Video", short: "Grok Imagine", badge: "Fast Gen" },
  { name: "Volcengine Seedance 2.0", short: "Volcengine", badge: "Action" },
  { name: "Pika 2.0", short: "Pika 2.0", badge: "Effects" },
];

const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9 Landscape", desc: "YouTube / Widescreen", ratioClass: "aspect-video" },
  { id: "9:16", label: "9:16 Vertical", desc: "TikTok / Shorts / Reels", ratioClass: "aspect-[9/16]" },
  { id: "1:1", label: "1:1 Square", desc: "Instagram / Square", ratioClass: "aspect-square" },
  { id: "2.39:1", label: "2.39:1 Cinema", desc: "Anamorphic Scope", ratioClass: "aspect-[2.39/1]" },
];

const DIRECTOR_PERSONAS = [
  { id: "huobao_drama", label: "Viral Drama Hook", desc: "Fast pacing, dynamic cuts, high emotional tension" },
  { id: "cinematic_slowburn", label: "Cinematic Slow Burn", desc: "Deliberate movement, rich atmosphere, subtle acting" },
  { id: "action_packed", label: "High-Octane Action", desc: "Tracking dolly, kinetic momentum, high impact" },
  { id: "documentary", label: "Documentary Realism", desc: "Observational lens, natural lighting, lifelike grain" },
];

const INSPIRATION_TEMPLATES = [
  {
    title: "Cyberpunk Noir",
    icon: "bolt",
    prompt: "In the rain-soaked alleys of Neo Shinjuku, a weary cybernetic investigator tracks a stolen memory drive through neon-lit noodle bars, holographic billboards, and shadowy augmented reality black markets.",
    style: "Cyberpunk Neon & Wet Reflections (rain, holograms, high contrast)",
  },
  {
    title: "Anime Fantasy",
    icon: "auto_awesome",
    prompt: "A young sorceress stands atop floating ancient ruins at sunset. Luminous spirit butterflies circle her wooden staff as the clouds part to reveal a gargantuan celestial dragon gliding across the twilight sky.",
    style: "Anime / Makoto Shinkai Style (vibrant sky, emotional lighting)",
  },
  {
    title: "Viral Short Drama",
    icon: "trending_up",
    prompt: "A tense corporate boardroom confrontation where an unassuming junior analyst reveals an encrypted ledger that exposes the CEO's underground syndicate, triggering instant panic and private security intervention.",
    style: "K-Drama / Short Drama HD (soft glamour lighting, shallow depth of field)",
  },
  {
    title: "Cinematic Sci-Fi",
    icon: "rocket_launch",
    prompt: "A solo astronaut on the rust-colored plains of Mars discovers a massive obsidian monolith humming with low-frequency resonance. As dust storms whip past the helmet visor, ancient geometric glyphs ignite along the monolith face.",
    style: "Cinematic 35mm (Arri Alexa, natural film grain, anamorphic flare)",
  },
  {
    title: "Dark Gothic Mystery",
    icon: "candle",
    prompt: "Inside an abandoned Victorian manor during a midnight thunderstorm, a candle-bearing scholar enters a hidden library behind an ancient grandfather clock, illuminating floating dust motes and velvet-bound grimoires.",
    style: "Dark Moody Gothic Fantasy (shadows, atmospheric haze, candlelight)",
  },
];

const VIDEO_DURATIONS = [5, 6, 8, 10];
const VIDEO_RESOLUTIONS = ["auto", "720p", "1080p"];

const AVATAR_GRADIENTS = [
  "from-amber-500 to-rose-500",
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-purple-500 to-pink-600",
  "from-orange-500 to-red-600",
  "from-cyan-500 to-blue-600",
];

function getCharacterGradient(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function getPlayableVideoUrl(videoUrl) {
  if (!videoUrl) return "";
  if (videoUrl.startsWith("/api/video-prompt/media/")) return videoUrl;
  if (/^https?:\/\//i.test(videoUrl)) {
    const match = videoUrl.match(/([a-zA-Z0-9_-]+)(?:_\d+)?\.(?:mp4|webm|mov)/i);
    const id = match ? match[1] : "";
    if (id) {
      return `/api/video-prompt/media/${id}?url=${encodeURIComponent(videoUrl)}`;
    }
  }
  return videoUrl;
}

export default function VideoPromptPageClient() {
  // Core config & auth
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});

  // Active Tab: 'story' | 'characters' | 'storyboard' | 'studio' | 'settings'
  const [activeTab, setActiveTab] = useState("story");

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
  const [targetEngine, setTargetEngine] = useState(TARGET_ENGINES[0].name);
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
  const [newCharRole, setNewCharRole] = useState("Lead");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [extractingChars, setExtractingChars] = useState(false);

  // Storyboard Output
  const [generating, setGenerating] = useState(false);
  const [projectTitle, setProjectTitle] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
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
  const [videoErrors, setVideoErrors] = useState({});

  // Active scene selection for studio preview
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);

  // View modes
  const [storyboardViewMode, setStoryboardViewMode] = useState("grid"); // 'grid' | 'timeline'
  const [studioMonitorMode, setStudioMonitorMode] = useState("split"); // 'split' | 'video' | 'image'
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState("markdown"); // 'markdown' | 'json' | 'prompts-video' | 'prompts-image'
  const [lightboxImage, setLightboxImage] = useState(null);

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
        const projs = projectsData.projects || [];
        setProjects(projs);

        // Auto-select latest project on initial load if available
        if (projs.length > 0) {
          const p = projs[0];
          setCurrentProjectId(p.id);
          setProjectTitle(p.title || "");
          setPrompt(p.prompt || "");
          setLlmModel(p.llmModel || "");
          setImageModel(p.imageModel || "");
          setVideoModel(p.videoModel || "xai/grok-imagine-video");
          setStyle(p.style || STYLES[0].label);
          setTargetEngine(p.targetEngine || TARGET_ENGINES[0].name);
          setCharacterDesc(p.characterDesc || "");
          setRefImage(p.refImage || "");
          const sc = p.scenes || [];
          setScenes(sc);
          if (sc.length > 0) {
            setActiveTab("storyboard");
          }
        }
      } catch (err) {
        console.error("Init failed", err);
      }
    })();
  }, []);

  // Keyboard shortcut listener for Director Studio scene navigation
  useEffect(() => {
    if (activeTab !== "studio" || scenes.length === 0) return;
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedSceneIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedSceneIndex((prev) => Math.min(scenes.length - 1, prev + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, scenes.length]);

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
      setError("Reference must be an image file (PNG, JPG, WebP)");
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
      setError("Reference URL must start with http://, https://, or data:image/");
      return;
    }
    setRefImage(url);
    setRefUrlDraft("");
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
      setError("Cannot save empty project. Please enter a story prompt or generate scenes.");
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
    };
    setCharacters([...characters, char]);
    setNewCharName("");
    setNewCharRole("Lead");
    setNewCharDesc("");
  };

  const handleDeleteCharacter = (id) => {
    setCharacters(characters.filter((c) => c.id !== id));
  };

  // Auto-extract characters from script prompt using active LLM
  const handleAutoExtractCharacters = async () => {
    if (!prompt.trim()) {
      setError("Please enter a story concept or script first before extracting characters");
      return;
    }
    if (!llmModel) {
      setError("Please select an LLM model first in the top bar or settings");
      return;
    }

    setExtractingChars(true);
    setError("");
    try {
      const systemPrompt = `You are a character casting analyst. Extract the primary characters from the provided story concept.
Return a valid JSON array of characters ONLY with keys: "name", "role" (Lead, Antagonist, Supporting, Mentor, Cameo), and "description" (physical appearance, age, distinctive features, wardrobe).
Example format:
[
  {"name": "Jack Vance", "role": "Lead", "description": "35yo weary detective with worn leather trench coat, cybernetic glowing eye"}
]`;

      const payload = {
        model: llmModel,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Story Concept: ${prompt.trim()}` },
        ],
        temperature: 0.3,
      };

      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.error || "Failed to extract characters");

      const content = data.choices?.[0]?.message?.content || "";
      let cleaned = content.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
      }
      const firstB = cleaned.indexOf("[");
      const lastB = cleaned.lastIndexOf("]");
      if (firstB !== -1 && lastB !== -1) {
        cleaned = cleaned.slice(firstB, lastB + 1);
      }
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const mapped = parsed.map((c, i) => ({
          id: `${Date.now()}_${i}`,
          name: c.name || `Character ${i + 1}`,
          role: c.role || "Lead",
          description: c.description || "",
        }));
        setCharacters(mapped);
      }
    } catch (err) {
      setError(err.message || "Failed to parse characters");
    } finally {
      setExtractingChars(false);
    }
  };

  // Reset all state for a new storyboard project
  const handleNewStoryboard = () => {
    setCurrentProjectId(null);
    setProjectTitle("");
    setPrompt("");
    setCharacterDesc("");
    setCharacterConsistencyPrompt("");
    setScenes([]);
    setCharacters([]);
    setRefImage("");
    setRefUrlDraft("");
    setError("");
    setSelectedSceneIndex(0);
    setImageGenStates({});
    setVideoGenStates({});
    setVideoErrors({});
    setStyle(STYLES[0].label);
    setTargetEngine(TARGET_ENGINES[0].name);
    setAspectRatio("16:9");
    setSceneCount(4);
    setActiveTab("story");
  };

  // Apply template inspiration
  const handleApplyTemplate = (tmpl) => {
    setPrompt(tmpl.prompt);
    setStyle(tmpl.style);
    setError("");
  };

  // Generate Storyboard API
  const handleGenerateStoryboard = async () => {
    if (!prompt.trim()) {
      setError("Please enter a story concept or script");
      return;
    }
    if (!llmModel) {
      setError("Please select an LLM model in the top bar or settings");
      return;
    }

    setGenerating(true);
    setError("");
    try {
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
      setError("Please select an Image Generation Model first in the top bar or settings");
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

    setVideoErrors((prev) => ({ ...prev, [sceneIndex]: false }));
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
        setVideoErrors((prev) => ({ ...prev, [sceneIndex]: false }));
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
            setVideoErrors((prev) => ({ ...prev, [sceneIndex]: false }));
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
      setError("Please select an Image Model first in the top bar or settings");
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
      setError("Please select a Video Model first in the top bar or settings");
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

  // Add a blank shot directly to storyboard
  const handleAddShot = () => {
    const newIdx = scenes.length;
    const newShot = {
      sceneNumber: newIdx + 1,
      timecode: `00:${String(newIdx * 5).padStart(2, "0")} - 00:${String((newIdx + 1) * 5).padStart(2, "0")}`,
      summary: "New Scene Action Summary",
      imagePrompt: `Cinematic first frame, 35mm lens, natural lighting, --ar ${aspectRatio}`,
      motionPrompt: "Controlled camera pan across the scene, subject performs action, [SFX: Ambient background]",
      camera: "Medium Dolly In",
      lighting: "Soft Diffused Daylight",
      audioSfx: "Ambient room tone",
      voiceover: "",
      imageStatus: "idle",
      imageUrl: "",
      videoUrl: "",
      videoStatus: "idle",
    };
    const nextScenes = [...scenes, newShot];
    persistScenes(nextScenes);
    setSelectedSceneIndex(newIdx);
  };

  // Duplicate an existing shot
  const handleDuplicateShot = (idx) => {
    const target = scenes[idx];
    if (!target) return;
    const duplicated = {
      ...target,
      imageUrl: "",
      imageStatus: "idle",
      videoUrl: "",
      videoStatus: "idle",
      summary: `${target.summary} (Copy)`,
    };
    const nextScenes = [...scenes];
    nextScenes.splice(idx + 1, 0, duplicated);
    const reindexed = nextScenes.map((s, i) => ({ ...s, sceneNumber: i + 1 }));
    persistScenes(reindexed);
    setSelectedSceneIndex(idx + 1);
  };

  // Move shot up or down in sequence
  const handleMoveShot = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= scenes.length) return;
    const nextScenes = [...scenes];
    const [moved] = nextScenes.splice(idx, 1);
    nextScenes.splice(targetIdx, 0, moved);
    const reindexed = nextScenes.map((s, i) => ({ ...s, sceneNumber: i + 1 }));
    persistScenes(reindexed);
    setSelectedSceneIndex(targetIdx);
  };

  // Delete shot with confirmation
  const handleDeleteShot = (idx) => {
    if (!confirm(`Delete Shot #${idx + 1}?`)) return;
    const nextScenes = scenes.filter((_, i) => i !== idx);
    const reindexed = nextScenes.map((s, i) => ({ ...s, sceneNumber: i + 1 }));
    persistScenes(reindexed);
    if (selectedSceneIndex >= reindexed.length) {
      setSelectedSceneIndex(Math.max(0, reindexed.length - 1));
    }
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
    setTargetEngine(p.targetEngine || TARGET_ENGINES[0].name);
    setCharacterDesc(p.characterDesc || "");
    setRefImage(p.refImage || "");
    setScenes(p.scenes || []);
    setVideoErrors({});
    setSelectedSceneIndex(0);
    setHistoryOpen(false);
  };

  const handleDeleteProject = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this storyboard project?")) return;
    try {
      await fetch(`/api/video-prompt/projects/${id}`, { method: "DELETE" });
      await loadProjects();
      if (currentProjectId === id) {
        handleNewStoryboard();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Format full exported script/prompts
  const exportFullScript = (format = "markdown") => {
    if (format === "json") {
      return JSON.stringify(
        {
          projectTitle: projectTitle || "Untitled Storyboard",
          style,
          targetEngine,
          aspectRatio,
          characterConsistencyPrompt,
          scenes,
        },
        null,
        2
      );
    }

    if (format === "prompts-video") {
      return scenes
        .map((s, idx) => `// Shot ${s.sceneNumber || idx + 1} (${s.timecode || "00:00"})\n${s.motionPrompt}`)
        .join("\n\n");
    }

    if (format === "prompts-image") {
      return scenes
        .map((s, idx) => `// Shot ${s.sceneNumber || idx + 1} (${s.timecode || "00:00"})\n${s.imagePrompt}`)
        .join("\n\n");
    }

    // Default: Markdown
    let output = `# ${projectTitle || "Video Drama Storyboard"}\n\n`;
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

  const handleDownloadExport = (format) => {
    const text = exportFullScript(format);
    const blob = new Blob([text], {
      type: format === "json" ? "application/json" : "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = (projectTitle || "storyboard").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const ext = format === "json" ? "json" : format === "markdown" ? "md" : "txt";
    link.href = url;
    link.download = `${safeTitle}-${format}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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

  const imagesReadyCount = useMemo(() => scenes.filter((s) => s.imageUrl).length, [scenes]);
  const videosReadyCount = useMemo(() => scenes.filter((s) => s.videoUrl && !videoErrors[s.sceneNumber - 1]).length, [scenes, videoErrors]);
  const activeScene = scenes[selectedSceneIndex] || scenes[0];

  return (
    <div className="flex flex-1 flex-col min-h-0 h-full w-full overflow-hidden bg-bg text-text-main">
      {/* Top Studio Bar: Tier 1 = project info & quick actions, Tier 2 = production pipeline stages */}
      <header className="shrink-0 z-20 border-b border-border bg-surface/95 backdrop-blur-md">
        {/* Tier 1: Project Identity & Global Actions */}
        <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 h-13 sm:h-14">
          {/* Project identity */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="size-8 sm:size-9 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[18px] sm:text-[20px]" aria-hidden="true">movie_filter</span>
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                {isEditingTitle ? (
                  <input
                    type="text"
                    autoFocus
                    aria-label="Project title"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    onBlur={() => setIsEditingTitle(false)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setIsEditingTitle(false)}
                    className="h-7 sm:h-8 w-36 sm:w-60 text-xs sm:text-sm font-semibold bg-surface-2 border border-primary rounded-md px-2 outline-none text-text-main"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(true)}
                    className="group flex items-center gap-1 min-h-[32px] max-w-[130px] sm:max-w-xs text-xs sm:text-sm font-semibold tracking-tight text-left rounded-md hover:text-primary focus-visible:outline-2 focus-visible:outline-primary transition-colors"
                    title="Click to rename project"
                  >
                    <span className="truncate">{projectTitle || "Video Storyboard Studio"}</span>
                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] text-text-muted opacity-60 group-hover:opacity-100 shrink-0" aria-hidden="true">
                      edit
                    </span>
                  </button>
                )}
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] leading-4 text-text-muted whitespace-nowrap">
                <span>{scenes.length} shots</span>
                <span className="text-border" aria-hidden="true">·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{imagesReadyCount} img</span>
                <span className="text-border" aria-hidden="true">·</span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">{videosReadyCount} vid</span>
              </div>
            </div>
          </div>

          {/* Right cluster: Active model chips + Global actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Active Model Quick Switchers (2xl+) */}
            <div className="hidden 2xl:flex items-center gap-1 bg-surface-2/70 p-0.5 rounded-lg border border-border text-[11px]">
              {[
                { icon: "psychology", value: llmModel, empty: "No LLM", title: "Change script LLM model", open: () => setShowLlmModal(true) },
                { icon: "image", value: imageModel, empty: "No image model", title: "Change first-frame image model", open: () => setShowImageModal(true) },
                { icon: "movie", value: videoModel, empty: "No video model", title: "Change video model", open: () => setShowVideoModal(true) },
              ].map((m) => (
                <button
                  key={m.icon}
                  type="button"
                  onClick={m.open}
                  title={m.title}
                  className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    m.value
                      ? "text-text-main hover:bg-surface hover:text-primary"
                      : "text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px] text-primary" aria-hidden="true">{m.icon}</span>
                  <span className="truncate max-w-[85px] font-medium">{m.value ? m.value.split("/").pop() : m.empty}</span>
                </button>
              ))}
            </div>

            {/* Compact model status for xl (1280 - 1535px) */}
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className="hidden xl:inline-flex 2xl:hidden items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border bg-surface-2 text-text-muted hover:text-text-main text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-primary"
              title="Configure AI models in Settings"
            >
              <span className="material-symbols-outlined text-[14px] text-primary" aria-hidden="true">tune</span>
              <span>AI Pipeline</span>
            </button>

            <div className="hidden xl:block h-4 w-px bg-border mx-0.5" aria-hidden="true" />

            {/* Action buttons */}
            {[
              { key: "new", icon: "add", label: "New", title: "Start fresh project", onClick: handleNewStoryboard, show: true },
              { key: "save", icon: isSaving ? "progress_activity" : "save", label: "Save", title: "Save project", onClick: handleSaveProject, show: scenes.length > 0 || !!prompt.trim(), disabled: isSaving },
              { key: "export", icon: "file_download", label: "Export", title: "Export script and prompts", onClick: () => setExportModalOpen(true), show: scenes.length > 0 },
              {
                key: "history",
                icon: "history",
                label: `History (${projects.length})`,
                title: "Saved storyboard library",
                onClick: () => {
                  setHistoryOpen(!historyOpen);
                  loadProjects();
                },
                show: true,
                active: historyOpen,
              },
            ]
              .filter((a) => a.show)
              .map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.title}
                  aria-label={a.label}
                  aria-pressed={a.key === "history" ? !!a.active : undefined}
                  className={`inline-flex items-center justify-center gap-1.5 h-8 min-w-[36px] sm:min-w-[40px] px-2.5 sm:px-3 rounded-lg text-xs font-semibold border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-60 ${
                    a.key === "new"
                      ? "bg-brand-500 hover:bg-brand-600 text-white border-transparent shadow-xs"
                      : a.active
                      ? "bg-primary/10 text-primary border-primary/40"
                      : "bg-surface-2 hover:bg-surface-3 text-text-main border-border"
                  }`}
                >
                  <span className={`material-symbols-outlined text-[17px] ${a.disabled ? "animate-spin" : ""}`} aria-hidden="true">
                    {a.icon}
                  </span>
                  <span className="hidden md:inline">{a.label}</span>
                </button>
              ))}
          </div>
        </div>

        {/* Tier 2: Production Pipeline Stage Track */}
        <div className="flex items-center justify-between gap-3 px-2 sm:px-5 h-12 border-t border-border/50 bg-surface-2/30">
          <nav aria-label="Studio workflow" className="grid grid-cols-5 sm:flex sm:items-center gap-1 sm:gap-2 w-full sm:w-auto min-w-0">
            {[
              { id: "story", icon: "menu_book", label: "Story" },
              { id: "characters", icon: "groups", label: "Cast", count: characters.length },
              { id: "storyboard", icon: "grid_view", label: "Shots", count: scenes.length },
              { id: "studio", icon: "videocam", label: "Director" },
              { id: "settings", icon: "tune", label: "Settings" },
            ].map((t, i) => {
              const active = activeTab === t.id;
              return (
                <div key={t.id} className="flex items-center gap-1 sm:gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    aria-current={active ? "page" : undefined}
                    className={`w-full sm:w-auto inline-flex items-center justify-center gap-1.5 sm:gap-2 h-9 min-h-[40px] sm:min-h-[36px] px-1 sm:px-3 rounded-lg text-[11px] sm:text-xs font-medium transition-all focus-visible:outline-2 focus-visible:outline-primary min-w-0 ${
                      active
                        ? "bg-surface border border-border text-primary font-semibold shadow-xs ring-1 ring-primary/20"
                        : "border border-transparent text-text-muted hover:text-text-main hover:bg-surface/60"
                    }`}
                  >
                    <span
                      className={`size-4 sm:size-5 rounded-full text-[9px] sm:text-[10px] font-bold flex items-center justify-center shrink-0 ${
                        active ? "bg-primary text-white" : "bg-surface-2 text-text-muted border border-border"
                      }`}
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span className="material-symbols-outlined text-[15px] sm:text-[16px] hidden sm:inline shrink-0" aria-hidden="true">{t.icon}</span>
                    <span className="truncate">{t.label}</span>
                    {t.count > 0 && (
                      <span className={`min-w-4 h-4 px-1 rounded-full text-[9px] sm:text-[10px] font-bold hidden sm:flex items-center justify-center shrink-0 ${
                        active ? "bg-primary/15 text-primary" : "bg-surface-2 text-text-muted border border-border"
                      }`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                  {i < 4 && (
                    <span className="hidden sm:inline-flex items-center text-text-muted/30 select-none shrink-0" aria-hidden="true">
                      <span className="material-symbols-outlined text-[13px]">chevron_right</span>
                    </span>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Pipeline Metadata (2xl+) */}
          <div className="hidden 2xl:flex items-center gap-2 text-[11px] text-text-muted shrink-0">
            <span className="truncate max-w-[180px]">
              Engine: <span className="text-text-main font-medium">{targetEngine.split("(")[0]}</span>
            </span>
            <span className="text-border" aria-hidden="true">·</span>
            <span className="font-mono text-primary font-medium">~{scenes.length * 5}s runtime</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex flex-1 min-h-0 h-full overflow-hidden relative">
        {/* TAB 1: SCRIPT & STORY INPUT */}
        {activeTab === "story" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              {/* Inspiration Template Chips */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-muted flex items-center gap-1.5 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-primary text-[15px]">lightbulb</span>
                    Quick Starters & Inspiration
                  </span>
                  <span className="text-[11px] text-text-muted">Click to populate concept</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                  {INSPIRATION_TEMPLATES.map((tmpl) => (
                    <button
                      key={tmpl.title}
                      type="button"
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="p-2.5 rounded-xl border border-border bg-surface/60 hover:bg-surface hover:border-primary/50 text-left transition-all group flex flex-col justify-between"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-main group-hover:text-primary">
                        <span className="material-symbols-outlined text-[16px] text-primary">{tmpl.icon}</span>
                        <span className="truncate">{tmpl.title}</span>
                      </div>
                      <p className="text-[10px] text-text-muted line-clamp-2 mt-1 leading-relaxed">
                        {tmpl.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Script Editor Card */}
              <div className="p-5 rounded-2xl bg-surface border border-border shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">auto_fix_high</span>
                      Storyline & Drama Script
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Input your short story, drama screenplay, novel excerpt, or video concept
                    </p>
                  </div>
                  {prompt && (
                    <button
                      onClick={() => setPrompt("")}
                      className="text-[11px] text-text-muted hover:text-destructive flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[13px]">clear</span>
                      Clear Text
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <textarea
                    rows={6}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter your storyline here... For example: A high-stakes corporate betrayal in Neo Tokyo where a rookie detective uncovers a conspiracy connecting the CEO with underground cybernetic syndicates. Scene 1 opens in the rain..."
                    className="w-full text-sm bg-surface border border-border rounded-xl p-3.5 outline-none focus:border-primary transition-all resize-y placeholder:text-text-muted/60 leading-relaxed font-sans"
                  />
                  <div className="flex justify-between text-[11px] text-text-muted px-1">
                    <span>Break into natural dramatic beats for best storyboard flow</span>
                    <span>{prompt.length} characters</span>
                  </div>
                </div>

                {/* Director Configuration Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/70">
                  {/* Style selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">palette</span>
                      Visual Style Preset
                    </label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full text-xs bg-surface border border-border rounded-xl px-3 py-2.5 outline-none focus:border-primary cursor-pointer text-text-main shadow-xs"
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
                      <span className="material-symbols-outlined text-[15px] text-primary">smart_display</span>
                      Target Video Engine
                    </label>
                    <select
                      value={targetEngine}
                      onChange={(e) => setTargetEngine(e.target.value)}
                      className="w-full text-xs bg-surface border border-border rounded-xl px-3 py-2.5 outline-none focus:border-primary cursor-pointer text-text-main shadow-xs"
                    >
                      {TARGET_ENGINES.map((eng) => (
                        <option key={eng.name} value={eng.name}>
                          {eng.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Scene Count */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px] text-primary">movie</span>
                        Storyboard Shots Count
                      </label>
                      <span className="text-[11px] font-semibold text-primary">
                        {sceneCount} shots (~{sceneCount * 5}s runtime)
                      </span>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <input
                        type="range"
                        min="2"
                        max="12"
                        value={sceneCount}
                        onChange={(e) => setSceneCount(Number(e.target.value))}
                        className="flex-1 accent-primary cursor-pointer h-2 bg-surface-2 rounded-lg"
                      />
                      <span className="text-xs font-bold px-2.5 py-1 bg-surface-2 rounded-lg border border-border w-12 text-center">
                        {sceneCount}
                      </span>
                    </div>
                  </div>

                  {/* Visual Aspect Ratio Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">aspect_ratio</span>
                      Aspect Ratio
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {ASPECT_RATIOS.map((ratio) => (
                        <button
                          key={ratio.id}
                          type="button"
                          onClick={() => setAspectRatio(ratio.id)}
                          className={`p-2 rounded-xl border text-center transition-all flex flex-col items-center justify-center gap-1 ${
                            aspectRatio === ratio.id
                              ? "bg-primary text-white border-primary shadow-xs font-semibold"
                              : "bg-surface border-border hover:bg-surface-2 text-text-main"
                          }`}
                        >
                          <span className="text-xs font-bold">{ratio.id}</span>
                          <span
                            className={`text-[9px] truncate max-w-full ${
                              aspectRatio === ratio.id ? "text-white/90" : "text-text-muted"
                            }`}
                          >
                            {ratio.id === "16:9" ? "Landscape" : ratio.id === "9:16" ? "Shorts" : ratio.id === "1:1" ? "Square" : "Cinema"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Director Persona / Tone */}
                <div className="space-y-1.5 pt-2 border-t border-border/70">
                  <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                    <span className="material-symbols-outlined text-[15px] text-primary">psychology</span>
                    Director Persona & Pacing
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                    {DIRECTOR_PERSONAS.map((dp) => (
                      <button
                        key={dp.id}
                        type="button"
                        onClick={() => setDirectorPersona(dp.id)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          directorPersona === dp.id
                            ? "bg-primary/10 border-primary text-text-main shadow-xs"
                            : "bg-surface border-border hover:bg-surface-2 text-text-muted hover:text-text-main"
                        }`}
                      >
                        <p className={`text-xs font-semibold ${directorPersona === dp.id ? "text-primary" : ""}`}>
                          {dp.label}
                        </p>
                        <p className="text-[10px] text-text-muted mt-0.5 line-clamp-2">{dp.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reference Portrait / Visual anchor */}
                <div className="space-y-2 pt-2 border-t border-border/70">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">face</span>
                      Reference Character / Keyframe Image (Optional)
                    </label>
                    {refImage && (
                      <button
                        onClick={clearRefImage}
                        className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">delete</span>
                        Remove Image
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setRefDragging(true);
                      }}
                      onDragLeave={() => setRefDragging(false)}
                      onDrop={handleRefDrop}
                      onClick={() => refFileInputRef.current?.click()}
                      className={`flex-1 min-h-[80px] border-2 border-dashed rounded-xl flex items-center justify-center p-3 cursor-pointer transition-all ${
                        refDragging
                          ? "border-primary bg-primary/10"
                          : refImage
                            ? "border-border bg-surface-2/40"
                            : "border-border hover:border-primary/50 bg-surface/50"
                      }`}
                    >
                      <input
                        ref={refFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleRefFile}
                        className="hidden"
                      />
                      <div className="flex items-center gap-3 text-center sm:text-left">
                        <span className="material-symbols-outlined text-primary text-[26px]">
                          cloud_upload
                        </span>
                        <div>
                          <p className="text-xs font-medium text-text-main">
                            Drop character portrait or scene reference here
                          </p>
                          <p className="text-[10px] text-text-muted mt-0.5">
                            PNG, JPG, WebP up to 15MB. Injected into image generator.
                          </p>
                        </div>
                      </div>
                    </div>

                    {refImage && (
                      <div className="relative h-20 w-28 rounded-xl overflow-hidden border border-border bg-black/40 shrink-0 shadow-xs group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={refImage} alt="Ref preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setLightboxImage(refImage)}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity"
                        >
                          <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Or paste reference image URL (https://...)"
                      value={refUrlDraft}
                      onChange={(e) => setRefUrlDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyRefUrl()}
                      className="flex-1 text-xs bg-surface border border-border rounded-xl px-3 py-1.5 outline-none focus:border-primary"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applyRefUrl}
                      disabled={!refUrlDraft.trim()}
                    >
                      Apply URL
                    </Button>
                  </div>
                </div>

                {/* Action CTA Bar */}
                <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/70">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>LLM Director:</span>
                    <button
                      onClick={() => setShowLlmModal(true)}
                      className="px-2 py-0.5 rounded-lg bg-surface-2 border border-border text-primary font-semibold hover:border-primary transition-colors flex items-center gap-1"
                    >
                      <span className="truncate max-w-[160px]">{llmModel || "Select Model..."}</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_drop_down</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <Button
                      variant="primary"
                      size="md"
                      icon="auto_fix_high"
                      loading={generating}
                      onClick={handleGenerateStoryboard}
                      disabled={generating || !prompt.trim()}
                      className="w-full sm:w-auto px-6 font-semibold"
                    >
                      Generate Storyboard Pipeline
                    </Button>
                  </div>
                </div>

                {error && (
                  <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                      <span>{error}</span>
                    </div>
                    <button onClick={() => setError("")} className="hover:opacity-75">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CAST & CHARACTERS */}
        {activeTab === "characters" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              <div className="p-5 rounded-2xl bg-surface border border-border shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">groups</span>
                      Cast & Character Consistency Hub
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Define persistent visual traits, face structures, and wardrobe locks across all shots
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {prompt.trim() && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon="auto_awesome"
                        loading={extractingChars}
                        onClick={handleAutoExtractCharacters}
                        title="Analyze script and extract character specs automatically"
                      >
                        Extract from Script
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      icon="add"
                      onClick={handleAddCharacter}
                      disabled={!newCharName.trim()}
                    >
                      Add Cast Member
                    </Button>
                  </div>
                </div>

                {/* Add new character form */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-surface-2/60 border border-border">
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Character Name *</label>
                    <input
                      type="text"
                      value={newCharName}
                      onChange={(e) => setNewCharName(e.target.value)}
                      placeholder="e.g. Jack Vance"
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary text-text-main"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Role / Archetype</label>
                    <select
                      value={newCharRole}
                      onChange={(e) => setNewCharRole(e.target.value)}
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary text-text-main cursor-pointer"
                    >
                      <option value="Lead">Lead Protagonist</option>
                      <option value="Antagonist">Antagonist / Rival</option>
                      <option value="Supporting">Supporting Cast</option>
                      <option value="Mentor">Mentor / Guide</option>
                      <option value="Cameo">Cameo / Extra</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Visual Description / Wardrobe</label>
                    <input
                      type="text"
                      value={newCharDesc}
                      onChange={(e) => setNewCharDesc(e.target.value)}
                      placeholder="e.g. 35yo, worn brown trench coat, glowing blue cyber eye"
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary text-text-main"
                    />
                  </div>
                </div>

                {/* Character List Grid */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                      Active Cast & Consistency Anchors ({characters.length})
                    </h3>
                    <span className="text-[11px] text-text-muted">
                      Injected into every image and video prompt
                    </span>
                  </div>

                  {characters.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-border rounded-2xl text-text-muted text-xs space-y-2">
                      <span className="material-symbols-outlined text-[36px] text-primary/60">person_search</span>
                      <p className="font-medium text-text-main">No Cast Members Defined Yet</p>
                      <p className="text-[11px] text-text-muted max-w-sm mx-auto">
                        Add key characters above or click &quot;Extract from Script&quot; to parse them from your storyline automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {characters.map((char) => (
                        <div
                          key={char.id}
                          className="p-4 rounded-xl bg-surface border border-border hover:border-primary/50 transition-all space-y-2.5 relative group shadow-xs"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div
                                className={`h-9 w-9 rounded-full bg-gradient-to-tr ${getCharacterGradient(
                                  char.name
                                )} text-white flex items-center justify-center font-bold text-sm shadow-xs`}
                              >
                                {char.name[0]?.toUpperCase() || "C"}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-text-main">{char.name}</h4>
                                <span className="inline-block mt-0.5 px-2 py-0.2 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                  {char.role}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteCharacter(char.id)}
                              className="text-text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1"
                              title="Delete character"
                            >
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </div>
                          <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                            {char.description || "No specific visual traits assigned."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Global Character Consistency Prompt */}
                <div className="space-y-2 pt-4 border-t border-border/70">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">lock_reset</span>
                      Global Character Consistency Rules
                    </label>
                    <span className="text-[11px] text-text-muted">Injected across all shot generations</span>
                  </div>
                  <textarea
                    rows={3}
                    value={characterConsistencyPrompt}
                    onChange={(e) => setCharacterConsistencyPrompt(e.target.value)}
                    placeholder="Global prompt injected into every scene to maintain visual style, actor facial features, lighting tone, and wardrobe lock..."
                    className="w-full text-xs bg-surface border border-border rounded-xl p-3 outline-none focus:border-primary font-mono leading-relaxed"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: STORYBOARD SHOTS (THE PRODUCTION BOARD) */}
        {activeTab === "storyboard" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header Toolbar: Stats, View Toggles & Batch Actions */}
            <div className="p-4 border-b border-border bg-surface/60 backdrop-blur-sm shrink-0 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">grid_view</span>
                    {projectTitle || "Generated Storyboard Production Board"}
                  </h2>
                  <span className="text-xs text-text-muted font-mono">
                    ({scenes.length} Shots • ~{scenes.length * 5}s runtime)
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  Visual Style: <span className="text-text-main font-medium">{style.split("(")[0]}</span> • Target Engine:{" "}
                  <span className="text-text-main font-medium">{targetEngine.split("(")[0]}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle: Grid vs Timeline */}
                <div className="flex items-center bg-surface-2 p-0.5 rounded-lg border border-border">
                  <button
                    onClick={() => setStoryboardViewMode("grid")}
                    className={`p-1.5 rounded text-xs transition-colors ${
                      storyboardViewMode === "grid"
                        ? "bg-surface text-text-main shadow-xs"
                        : "text-text-muted hover:text-text-main"
                    }`}
                    title="Grid Card View"
                  >
                    <span className="material-symbols-outlined text-[16px]">view_module</span>
                  </button>
                  <button
                    onClick={() => setStoryboardViewMode("timeline")}
                    className={`p-1.5 rounded text-xs transition-colors ${
                      storyboardViewMode === "timeline"
                        ? "bg-surface text-text-main shadow-xs"
                        : "text-text-muted hover:text-text-main"
                    }`}
                    title="Timeline Table View"
                  >
                    <span className="material-symbols-outlined text-[16px]">view_list</span>
                  </button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  icon="add"
                  onClick={handleAddShot}
                  className="text-xs"
                >
                  Add Shot
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  icon="image"
                  onClick={handleBatchGenerateImages}
                  loading={batchGenRunning}
                  disabled={batchGenRunning || scenes.length === 0}
                  className="text-xs"
                >
                  Batch Images
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  icon="movie"
                  onClick={handleBatchGenerateVideos}
                  loading={batchVideoRunning}
                  disabled={batchVideoRunning || scenes.length === 0}
                  className="text-xs"
                >
                  Batch Videos
                </Button>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
              {scenes.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed border-border rounded-2xl text-text-muted text-xs space-y-3 max-w-lg mx-auto">
                  <span className="material-symbols-outlined text-[48px] text-primary/50">movie_edit</span>
                  <h3 className="text-base font-semibold text-text-main">No Storyboard Shots Yet</h3>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    Go to Tab 1 (Story), enter your script or concept, and generate the storyboard pipeline.
                  </p>
                  <div className="pt-2">
                    <Button variant="primary" size="sm" onClick={() => setActiveTab("story")}>
                      Go to Story Input
                    </Button>
                  </div>
                </div>
              ) : storyboardViewMode === "grid" ? (
                /* GRID CARD VIEW */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {scenes.map((scene, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-2xl border transition-all flex flex-col justify-between group ${
                        selectedSceneIndex === idx
                          ? "bg-surface border-primary/70 shadow-md ring-1 ring-primary/30"
                          : "bg-surface/70 border-border hover:border-primary/40 hover:bg-surface"
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Header: Shot Number & Timecode */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                              Shot #{scene.sceneNumber || idx + 1}
                            </span>
                            <span className="text-[11px] text-text-muted font-mono">{scene.timecode || `00:${idx * 5}s`}</span>
                          </div>

                          {/* Status Pill */}
                          <div className="flex items-center gap-1">
                            {scene.videoUrl && !videoErrors[idx] ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/15 text-blue-500 border border-blue-500/25 font-semibold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">check_circle</span>
                                Video Ready
                              </span>
                            ) : videoErrors[idx] ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-500 border border-amber-500/25 font-semibold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                Expired
                              </span>
                            ) : scene.imageUrl ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 font-semibold flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">image</span>
                                Image Ready
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-surface-2 text-text-muted border border-border font-medium">
                                Draft
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Media Thumbnail Container */}
                        <div className="aspect-video w-full rounded-xl bg-surface-2 border border-border overflow-hidden relative group/thumb flex items-center justify-center">
                          {scene.videoUrl && !videoErrors[idx] ? (
                            <video
                              key={scene.videoUrl}
                              src={getPlayableVideoUrl(scene.videoUrl)}
                              className="w-full h-full object-cover"
                              muted
                              loop
                              onMouseEnter={(e) => e.target.play().catch(() => {})}
                              onMouseLeave={(e) => e.target.pause()}
                              onError={() => setVideoErrors((prev) => ({ ...prev, [idx]: true }))}
                            />
                          ) : scene.imageUrl ? (
                            <div className="relative w-full h-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={scene.imageUrl} alt={`Shot ${idx + 1}`} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => setLightboxImage(scene.imageUrl)}
                                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                title="Zoom Image"
                              >
                                <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                              </button>
                            </div>
                          ) : (
                            <div className="text-center text-text-muted/60 p-4">
                              <span className="material-symbols-outlined text-[32px]">image</span>
                              <p className="text-[11px] mt-1">No media rendered</p>
                              <button
                                type="button"
                                onClick={() => handleGenerateImage(idx)}
                                className="mt-2 px-2.5 py-1 rounded-md text-[11px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                              >
                                Generate First Frame
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Shot Summary */}
                        <h4 className="text-xs font-semibold text-text-main line-clamp-2 leading-snug">
                          {scene.summary}
                        </h4>

                        {/* Motion Prompt snippet */}
                        <div className="p-2.5 rounded-xl bg-surface-2/60 border border-border text-[11px] text-text-muted line-clamp-2 font-mono leading-relaxed relative group/code">
                          {scene.motionPrompt}
                          <button
                            type="button"
                            onClick={() => copy(scene.motionPrompt)}
                            className="absolute top-1.5 right-1.5 p-1 rounded bg-surface border border-border text-text-muted hover:text-primary opacity-0 group-hover/code:opacity-100 transition-opacity"
                            title="Copy Motion Prompt"
                          >
                            <span className="material-symbols-outlined text-[13px]">content_copy</span>
                          </button>
                        </div>

                        {/* Camera & Lighting tags */}
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {scene.camera && (
                            <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-text-muted flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px] text-primary">videocam</span>
                              {scene.camera}
                            </span>
                          )}
                          {scene.lighting && (
                            <span className="px-2 py-0.5 rounded-md bg-surface-2 border border-border text-text-muted flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px] text-amber-500">wb_sunny</span>
                              {scene.lighting}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      <div className="pt-3 mt-3 border-t border-border flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveShot(idx, -1)}
                            disabled={idx === 0}
                            className="p-1 rounded text-text-muted hover:text-text-main disabled:opacity-30"
                            title="Move Up"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveShot(idx, 1)}
                            disabled={idx === scenes.length - 1}
                            className="p-1 rounded text-text-muted hover:text-text-main disabled:opacity-30"
                            title="Move Down"
                          >
                            <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateShot(idx)}
                            className="p-1 rounded text-text-muted hover:text-text-main"
                            title="Duplicate Shot"
                          >
                            <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteShot(idx)}
                            className="p-1 rounded text-text-muted hover:text-destructive"
                            title="Delete Shot"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </div>

                        <Button
                          variant="ghost"
                          size="xs"
                          icon="movie_edit"
                          onClick={() => {
                            setSelectedSceneIndex(idx);
                            setActiveTab("studio");
                          }}
                        >
                          Direct in Studio
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* TIMELINE TABLE VIEW */
                <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-surface-2 text-text-muted font-semibold text-[11px] uppercase tracking-wider">
                          <th className="py-3 px-4 w-16">Shot</th>
                          <th className="py-3 px-4 w-32">Preview</th>
                          <th className="py-3 px-4">Summary & Prompts</th>
                          <th className="py-3 px-4 w-48">Camera / Lighting</th>
                          <th className="py-3 px-4 w-40">Audio / SFX</th>
                          <th className="py-3 px-4 w-36 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {scenes.map((scene, idx) => (
                          <tr
                            key={idx}
                            onClick={() => {
                              setSelectedSceneIndex(idx);
                              setActiveTab("studio");
                            }}
                            className={`cursor-pointer transition-colors ${
                              selectedSceneIndex === idx
                                ? "bg-primary/5 hover:bg-primary/10"
                                : "hover:bg-surface-2/60"
                            }`}
                          >
                            <td className="py-3 px-4 font-mono font-bold text-primary">
                              #{scene.sceneNumber || idx + 1}
                              <div className="text-[10px] text-text-muted font-normal mt-0.5">{scene.timecode}</div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="h-16 w-24 rounded-lg bg-surface-2 border border-border overflow-hidden flex items-center justify-center">
                                {scene.videoUrl && !videoErrors[idx] ? (
                                  <video
                                    src={getPlayableVideoUrl(scene.videoUrl)}
                                    className="w-full h-full object-cover"
                                    muted
                                  />
                                ) : scene.imageUrl ? (
                                  <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="material-symbols-outlined text-text-muted text-[20px]">image</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-4 max-w-md">
                              <p className="font-semibold text-text-main line-clamp-1">{scene.summary}</p>
                              <p className="text-[11px] text-text-muted line-clamp-2 mt-1 font-mono">{scene.motionPrompt}</p>
                            </td>
                            <td className="py-3 px-4 text-[11px] text-text-muted">
                              <div><span className="font-medium text-text-main">Cam:</span> {scene.camera || "Auto"}</div>
                              <div className="mt-0.5"><span className="font-medium text-text-main">Light:</span> {scene.lighting || "Natural"}</div>
                            </td>
                            <td className="py-3 px-4 text-[11px] text-text-muted">
                              <div>{scene.audioSfx || "Ambient sound"}</div>
                              {scene.voiceover && <div className="text-primary mt-0.5 italic">&quot;{scene.voiceover}&quot;</div>}
                            </td>
                            <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  icon="image"
                                  loading={imageGenStates[idx]?.loading}
                                  onClick={() => handleGenerateImage(idx)}
                                  title="Generate Image"
                                />
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  icon="movie"
                                  loading={videoGenStates[idx]?.status === "processing"}
                                  onClick={() => handleGenerateVideo(idx)}
                                  title="Generate Video"
                                />
                                <Button
                                  variant="outline"
                                  size="xs"
                                  icon="open_in_new"
                                  onClick={() => {
                                    setSelectedSceneIndex(idx);
                                    setActiveTab("studio");
                                  }}
                                  title="Open in Studio"
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DIRECTOR STUDIO (THE MASTER SUITE) */}
        {activeTab === "studio" && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Filmstrip Timeline Rail */}
            <div className="w-64 border-r border-border bg-surface/40 overflow-y-auto custom-scrollbar p-3 space-y-2 shrink-0 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                    Filmstrip ({scenes.length})
                  </span>
                  <button
                    onClick={handleAddShot}
                    className="text-[11px] text-primary hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    Shot
                  </button>
                </div>

                <div className="space-y-1.5">
                  {scenes.map((sc, idx) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedSceneIndex(idx)}
                      className={`p-2 rounded-xl border text-left cursor-pointer transition-all flex items-center gap-2.5 ${
                        selectedSceneIndex === idx
                          ? "bg-surface border-primary text-text-main shadow-sm ring-1 ring-primary/20"
                          : "bg-surface/50 border-border/80 text-text-muted hover:border-primary/40 hover:bg-surface"
                      }`}
                    >
                      <div className="h-10 w-14 rounded-lg bg-surface-2 border border-border overflow-hidden shrink-0 flex items-center justify-center relative">
                        {sc.videoUrl && !videoErrors[idx] ? (
                          <video src={getPlayableVideoUrl(sc.videoUrl)} className="w-full h-full object-cover" muted />
                        ) : sc.imageUrl ? (
                          <img src={sc.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="material-symbols-outlined text-[16px] text-text-muted/60">movie</span>
                        )}
                        <span className="absolute bottom-0.5 right-0.5 text-[8px] font-bold bg-black/70 text-white px-1 rounded">
                          #{sc.sceneNumber || idx + 1}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-text-main truncate">Shot #{sc.sceneNumber || idx + 1}</span>
                          <span className="text-[9px] text-text-muted">{sc.timecode || `${idx * 5}s`}</span>
                        </div>
                        <p className="text-[10px] text-text-muted truncate mt-0.5">{sc.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-border">
                <Button variant="outline" size="sm" fullWidth icon="add" onClick={handleAddShot}>
                  Add New Shot
                </Button>
              </div>
            </div>

            {/* Right Director Canvas & Monitor */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-5">
              {activeScene ? (
                <div className="max-w-4xl space-y-5">
                  {/* Director Monitor Top Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-surface border border-border shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedSceneIndex((prev) => Math.max(0, prev - 1))}
                          disabled={selectedSceneIndex === 0}
                          className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-surface-2 disabled:opacity-30"
                          title="Previous Shot (Left Arrow)"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSceneIndex((prev) => Math.min(scenes.length - 1, prev + 1))}
                          disabled={selectedSceneIndex === scenes.length - 1}
                          className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-surface-2 disabled:opacity-30"
                          title="Next Shot (Right Arrow)"
                        >
                          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </button>
                      </div>

                      <div>
                        <h2 className="text-sm font-semibold flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
                            Shot #{activeScene.sceneNumber || selectedSceneIndex + 1}
                          </span>
                          <span className="truncate max-w-md">{activeScene.summary}</span>
                        </h2>
                        <p className="text-[11px] text-text-muted mt-0.5">
                          Camera: {activeScene.camera || "35mm"} • Lighting: {activeScene.lighting || "Natural"} • Aspect: {aspectRatio}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Monitor Mode Switcher */}
                      <div className="flex items-center bg-surface-2 p-0.5 rounded-lg border border-border text-xs">
                        <button
                          type="button"
                          onClick={() => setStudioMonitorMode("split")}
                          className={`px-2 py-1 rounded font-medium transition-colors ${
                            studioMonitorMode === "split" ? "bg-surface text-text-main shadow-xs" : "text-text-muted"
                          }`}
                        >
                          Split View
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudioMonitorMode("video")}
                          className={`px-2 py-1 rounded font-medium transition-colors ${
                            studioMonitorMode === "video" ? "bg-surface text-text-main shadow-xs" : "text-text-muted"
                          }`}
                        >
                          Video Only
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudioMonitorMode("image")}
                          className={`px-2 py-1 rounded font-medium transition-colors ${
                            studioMonitorMode === "image" ? "bg-surface text-text-main shadow-xs" : "text-text-muted"
                          }`}
                        >
                          Keyframe Only
                        </button>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        icon="content_copy"
                        onClick={() => copy(activeScene.motionPrompt)}
                      >
                        Copy Prompt
                      </Button>
                    </div>
                  </div>

                  {/* Dual Monitor Preview Boxes */}
                  <div
                    className={`grid gap-4 ${
                      studioMonitorMode === "split"
                        ? "grid-cols-1 md:grid-cols-2"
                        : "grid-cols-1"
                    }`}
                  >
                    {/* First-frame Keyframe Box */}
                    {(studioMonitorMode === "split" || studioMonitorMode === "image") && (
                      <div className="p-4 rounded-2xl bg-surface border border-border shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1.5 text-text-main">
                            <span className="material-symbols-outlined text-primary text-[16px]">image</span>
                            First-Frame Keyframe
                          </span>
                          <span className="text-[11px] text-text-muted font-mono truncate max-w-[150px]">
                            {imageModel || "No model set"}
                          </span>
                        </div>

                        <div className="aspect-video rounded-xl bg-surface-2 border border-border overflow-hidden relative flex items-center justify-center group/img">
                          {activeScene.imageUrl ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={activeScene.imageUrl} alt="First frame" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  icon="zoom_in"
                                  onClick={() => setLightboxImage(activeScene.imageUrl)}
                                >
                                  Zoom
                                </Button>
                                <a
                                  href={activeScene.imageUrl}
                                  download={`shot-${activeScene.sceneNumber || selectedSceneIndex + 1}-keyframe.png`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface border border-border text-text-main hover:bg-surface-2 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[16px]">download</span>
                                  Download
                                </a>
                              </div>
                            </>
                          ) : (
                            <div className="text-center text-text-muted/60 p-4">
                              <span className="material-symbols-outlined text-[36px]">image_search</span>
                              <p className="text-xs mt-1">First-frame not rendered yet</p>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <Button variant="outline" size="xs" onClick={() => setShowImageModal(true)}>
                            Change Image Model
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            icon="draw"
                            loading={imageGenStates[selectedSceneIndex]?.loading}
                            onClick={() => handleGenerateImage(selectedSceneIndex)}
                          >
                            Generate Keyframe
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* AI Video Render Box */}
                    {(studioMonitorMode === "split" || studioMonitorMode === "video") && (
                      <div className="p-4 rounded-2xl bg-surface border border-border shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1.5 text-text-main">
                            <span className="material-symbols-outlined text-primary text-[16px]">movie</span>
                            AI Motion Video Clip
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted font-mono truncate max-w-[150px]">
                              {videoModel || "No model set"}
                            </span>
                            {activeScene.videoUrl && !videoErrors[selectedSceneIndex] && (
                              <a
                                href={`${getPlayableVideoUrl(activeScene.videoUrl)}${
                                  getPlayableVideoUrl(activeScene.videoUrl).includes("?") ? "&" : "?"
                                }download=1`}
                                download={`shot-${activeScene.sceneNumber || selectedSceneIndex + 1}.mp4`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text-main transition-colors"
                                title="Download MP4"
                              >
                                <span className="material-symbols-outlined text-[13px] text-primary">download</span>
                                MP4
                              </a>
                            )}
                          </div>
                        </div>

                        <div className="aspect-video rounded-xl bg-black/80 border border-border overflow-hidden relative flex items-center justify-center">
                          {activeScene.videoUrl && !videoErrors[selectedSceneIndex] ? (
                            <video
                              key={activeScene.videoUrl}
                              src={getPlayableVideoUrl(activeScene.videoUrl)}
                              controls
                              className="w-full h-full object-cover"
                              onError={() => setVideoErrors((prev) => ({ ...prev, [selectedSceneIndex]: true }))}
                            />
                          ) : videoErrors[selectedSceneIndex] ? (
                            <div className="text-center text-text-muted p-4 space-y-2">
                              <span className="material-symbols-outlined text-amber-500 text-[32px]">warning</span>
                              <p className="text-xs font-semibold text-text-main">Video stream unavailable or expired</p>
                              <p className="text-[11px] text-text-muted max-w-xs mx-auto">
                                The temporary video link has expired. Click below to re-render this shot.
                              </p>
                              <Button
                                variant="primary"
                                size="xs"
                                icon="refresh"
                                onClick={() => {
                                  setVideoErrors((prev) => ({ ...prev, [selectedSceneIndex]: false }));
                                  handleGenerateVideo(selectedSceneIndex);
                                }}
                              >
                                Re-render Video
                              </Button>
                            </div>
                          ) : (
                            <div className="text-center text-text-muted/60 p-4">
                              <span className="material-symbols-outlined text-[36px]">videocam_off</span>
                              <p className="text-xs mt-1">Video clip not rendered yet</p>
                              {videoGenStates[selectedSceneIndex]?.status === "processing" && (
                                <p className="text-xs text-primary font-medium mt-1 animate-pulse">
                                  Rendering video motion on AI cluster...
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <Button variant="outline" size="xs" onClick={() => setShowVideoModal(true)}>
                            Change Video Model
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            icon="play_arrow"
                            loading={
                              videoGenStates[selectedSceneIndex]?.status === "processing" ||
                              videoGenStates[selectedSceneIndex]?.status === "submitting"
                            }
                            onClick={() => handleGenerateVideo(selectedSceneIndex)}
                          >
                            Render Video Clip
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prompt Engineering Inspector for Current Scene */}
                  <div className="p-5 rounded-2xl bg-surface border border-border space-y-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                        Director Prompt Engineering Details
                      </h3>
                      <span className="text-[11px] text-text-muted">Edits auto-save to project</span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-primary text-[15px]">image</span>
                          First-Frame Image Generation Prompt
                        </label>
                        <button
                          onClick={() => copy(activeScene.imagePrompt)}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[13px]">content_copy</span>
                          Copy
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={activeScene.imagePrompt}
                        onChange={(e) => {
                          const next = [...scenes];
                          next[selectedSceneIndex].imagePrompt = e.target.value;
                          persistScenes(next);
                        }}
                        className="w-full text-xs font-mono bg-surface border border-border rounded-xl p-3 outline-none focus:border-primary leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-primary text-[15px]">movie</span>
                          Video Motion & Camera Prompt
                        </label>
                        <button
                          onClick={() => copy(activeScene.motionPrompt)}
                          className="text-[11px] text-primary hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[13px]">content_copy</span>
                          Copy
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={activeScene.motionPrompt}
                        onChange={(e) => {
                          const next = [...scenes];
                          next[selectedSceneIndex].motionPrompt = e.target.value;
                          persistScenes(next);
                        }}
                        className="w-full text-xs font-mono bg-surface border border-border rounded-xl p-3 outline-none focus:border-primary leading-relaxed"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-border">
                      <div>
                        <label className="text-[11px] font-semibold text-text-muted flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">volume_up</span>
                          Audio Soundscape / SFX
                        </label>
                        <input
                          type="text"
                          value={activeScene.audioSfx || ""}
                          onChange={(e) => {
                            const next = [...scenes];
                            next[selectedSceneIndex].audioSfx = e.target.value;
                            persistScenes(next);
                          }}
                          className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-text-muted flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">record_voice_over</span>
                          Dialogue / Voiceover Line
                        </label>
                        <input
                          type="text"
                          value={activeScene.voiceover || ""}
                          onChange={(e) => {
                            const next = [...scenes];
                            next[selectedSceneIndex].voiceover = e.target.value;
                            persistScenes(next);
                          }}
                          className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-text-muted text-xs">
                  Select a shot from the left timeline to edit.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS GUI (FULL CONFIGURATOR) */}
        {activeTab === "settings" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              <div className="p-5 rounded-2xl bg-surface border border-border shadow-sm space-y-5">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">tune</span>
                    AI Model & Video Pipeline Configuration
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    Configure LLM scriptwriter, image generator, video render engine, and global parameters
                  </p>
                </div>

                {/* Model Selectors Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* LLM Model */}
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-2 shadow-xs">
                    <label className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-[16px]">psychology</span>
                      Script & Story LLM
                    </label>
                    <p className="text-[11px] text-text-muted">Parses concept into structured shots</p>
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
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-2 shadow-xs">
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
                  <div className="p-4 rounded-xl bg-surface border border-border space-y-2 shadow-xs">
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
                <div className="space-y-3 pt-4 border-t border-border">
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
                            className={`flex-1 py-2 text-xs rounded-lg border font-semibold transition-colors ${
                              videoDuration === dur
                                ? "bg-primary text-white border-primary shadow-xs"
                                : "bg-surface border-border text-text-main hover:bg-surface-2"
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
                            className={`flex-1 py-2 text-xs rounded-lg border font-semibold capitalize transition-colors ${
                              videoResolution === res
                                ? "bg-primary text-white border-primary shadow-xs"
                                : "bg-surface border-border text-text-main hover:bg-surface-2"
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
                        className="w-full text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary text-text-main cursor-pointer"
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
                <div className="space-y-1.5 pt-3 border-t border-border">
                  <label className="text-xs font-medium text-text-muted">Negative Prompt (Image & Video)</label>
                  <input
                    type="text"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="w-full text-xs bg-surface border border-border rounded-xl px-3.5 py-2.5 outline-none focus:border-primary font-mono"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Saved Projects Drawer / Sidebar */}
        {historyOpen && (
          <aside className="w-80 border-l border-border bg-surface/95 backdrop-blur-md p-4 flex flex-col justify-between shrink-0 z-30 shadow-lg animate-in slide-in-from-right duration-200">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Saved Storyboards ({projects.length})
                </h3>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-text-muted hover:text-text-main p-1"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <input
                type="text"
                placeholder="Search history..."
                value={searchHistory}
                onChange={(e) => setSearchHistory(e.target.value)}
                className="w-full text-xs bg-surface border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
              />

              <div className="space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-8 text-xs text-text-muted">No projects found</div>
                ) : (
                  filteredProjects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectProject(p)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all relative group shadow-xs ${
                        currentProjectId === p.id
                          ? "bg-primary/10 border-primary text-text-main"
                          : "bg-surface border-border hover:border-primary/50 text-text-muted hover:text-text-main"
                      }`}
                    >
                      <button
                        onClick={(e) => handleDeleteProject(e, p.id)}
                        className="absolute top-2.5 right-2.5 text-text-muted hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                        title="Delete project"
                      >
                        <span className="material-symbols-outlined text-[15px]">delete</span>
                      </button>
                      <h4 className="text-xs font-semibold truncate pr-5 text-text-main">
                        {p.title || "Untitled Storyboard"}
                      </h4>
                      <p className="text-[11px] text-text-muted line-clamp-2 mt-1">{p.prompt}</p>
                      <div className="flex items-center justify-between text-[10px] text-text-muted mt-2">
                        <span className="font-semibold text-primary">{p.scenes?.length || 0} shots</span>
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

      {/* Full Export Modal */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Export Storyboard & Prompts"
      >
        <div className="space-y-4 py-1 text-xs">
          {/* Format selection tabs */}
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <button
              onClick={() => setExportFormat("markdown")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                exportFormat === "markdown" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
              }`}
            >
              Markdown Script
            </button>
            <button
              onClick={() => setExportFormat("prompts-video")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                exportFormat === "prompts-video" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
              }`}
            >
              Video Prompts Only
            </button>
            <button
              onClick={() => setExportFormat("prompts-image")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                exportFormat === "prompts-image" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
              }`}
            >
              Image Prompts Only
            </button>
            <button
              onClick={() => setExportFormat("json")}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                exportFormat === "json" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"
              }`}
            >
              JSON Data
            </button>
          </div>

          <textarea
            rows={10}
            readOnly
            value={exportFullScript(exportFormat)}
            className="w-full text-xs font-mono bg-surface border border-border rounded-xl p-3 outline-none select-all"
          />

          <div className="flex items-center justify-between pt-1">
            <Button
              variant="outline"
              size="sm"
              icon="download"
              onClick={() => handleDownloadExport(exportFormat)}
            >
              Download File
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={copied ? "check" : "content_copy"}
              onClick={() => copy(exportFullScript(exportFormat))}
            >
              {copied ? "Copied" : "Copy to Clipboard"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Lightbox Image Preview Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-4xl w-full max-h-[90vh] overflow-hidden rounded-2xl bg-surface border border-border p-4 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-xs font-semibold">Keyframe High-Resolution Preview</span>
              <button onClick={() => setLightboxImage(null)} className="text-text-muted hover:text-text-main">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightboxImage} alt="Full preview" className="max-h-[70vh] object-contain rounded-xl" />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <a
                href={lightboxImage}
                download="keyframe-preview.png"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface border border-border text-text-main hover:bg-surface-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                Download
              </a>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setRefImage(lightboxImage);
                  setLightboxImage(null);
                }}
              >
                Use as Reference Keyframe
              </Button>
            </div>
          </div>
        </div>
      )}

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
        kindFilter="video"
        title="Select AI Video Generation Model"
      />
    </div>
  );
}
