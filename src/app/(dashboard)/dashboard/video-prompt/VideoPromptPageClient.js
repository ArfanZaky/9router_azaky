"use client";

// Design Read (antislop R-31, R-37, Part 3):
// Reading this as: multi-stage video storyboard and render workspace for technical operators,
// in 9Router's quiet control-panel language (DESIGN.md), dial ENERGY 1 / RHYTHM 2 / MOTION 1.
// Key decisions:
// - Palette: 9Router neutral surface tokens (bg, surface, surface-2, border) + single coral accent (primary).
// - Surfaces: flat border- separated panels (rounded-xl, border-border), no decorative gradients or floating shadows.
// - Typography: system sans for controls and prose, font-mono strictly for prompt strings, timecodes, and model IDs.
// - Icons: Material Symbols matched to concrete media objects (movie_edit, videocam, image, person, merge).

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button, ModelSelectModal, Modal, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  ANTISLOP_CHARACTER_EXTRACT_DIRECTIVE,
  DEFAULT_NEGATIVE_PROMPT,
  sanitizeAntislopText,
} from "@/lib/videoPrompt/antislop.js";

const STYLES = [
  { id: "cinematic", label: "35mm Film (Arri Alexa, natural grain, practical lighting)", tag: "35mm Film" },
  { id: "documentary", label: "Documentary Realism (handheld 24mm, available natural light)", tag: "Documentary" },
  { id: "drama", label: "Studio Drama (85mm portrait lens, shallow depth of field, soft key light)", tag: "Studio Drama" },
  { id: "noir", label: "Low-Key Noir (hard tungsten key light, deep shadows, 50mm prime)", tag: "Low-Key Noir" },
  { id: "anime", label: "2D Cel Animation (hand-painted background, directional daylight)", tag: "2D Animation" },
  { id: "stylized_3d", label: "3D Stylized Feature (matte shaders, studio three-point lighting)", tag: "3D Stylized" },
  { id: "vintage", label: "1970s Kodachrome (warm film stock, soft halation, 35mm prime)", tag: "1970s Film" },
  { id: "architectural", label: "Architectural Wide (24mm rectilinear lens, diffused overcast daylight)", tag: "Wide Angle" },
];

const TARGET_ENGINES = [
  { name: "General Video (Runway / Sora / Kling / Luma)", short: "General Video", badge: "Universal" },
  { name: "Google Flow (Veo 3.1 / Omni Flash)", short: "Google Flow", badge: "Veo 3.1" },
  { name: "Runway Gen-3 Alpha", short: "Runway Gen-3", badge: "Gen-3" },
  { name: "Kling 1.5", short: "Kling 1.5", badge: "Kling" },
  { name: "Luma Dream Machine", short: "Luma Dream", badge: "Luma" },
  { name: "OpenAI Sora", short: "OpenAI Sora", badge: "Sora" },
  { name: "Hailuo Minimax Video-01", short: "Hailuo Minimax", badge: "Minimax" },
  { name: "xAI Grok Imagine Video", short: "Grok Imagine", badge: "Grok" },
  { name: "Volcengine Seedance 2.0", short: "Volcengine", badge: "Seedance" },
  { name: "Pika 2.0", short: "Pika 2.0", badge: "Pika" },
];

const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9 Landscape", desc: "YouTube / Widescreen", ratioClass: "aspect-video" },
  { id: "9:16", label: "9:16 Vertical", desc: "TikTok / Shorts / Reels", ratioClass: "aspect-[9/16]" },
  { id: "1:1", label: "1:1 Square", desc: "Feed / Square", ratioClass: "aspect-square" },
  { id: "2.39:1", label: "2.39:1 Scope", desc: "Anamorphic Widescreen", ratioClass: "aspect-[2.39/1]" },
];

const DIRECTOR_PERSONAS = [
  { id: "huobao_drama", label: "Tight Drama Cut", desc: "Immediate conflict in shot 1, close reaction framing, direct dialogue" },
  { id: "cinematic_slowburn", label: "Measured Pacing", desc: "Unhurried camera movement, practical lighting, held reaction shots" },
  { id: "action_packed", label: "Physical Action", desc: "Clear spatial geography, tracking camera movement, impact sound" },
  { id: "documentary", label: "Observational", desc: "Handheld or tripod framing, available light, ambient room tone" },
];

// Each template uses an icon tied to its subject matter (R-04):
// theaters = stage/boardroom drama, videocam = documentary field shoot,
// directions_car = night transit, menu_book = archival investigation, photo_camera = product tabletop.
const INSPIRATION_TEMPLATES = [
  {
    title: "Boardroom Audit",
    icon: "theaters",
    prompt: "During a late-evening audit in a glass-walled conference room, a forensic accountant places a stamped transfer ledger on the table in front of the CFO, while rain streaks the window behind them.",
    style: "Studio Drama (85mm portrait lens, shallow depth of field, soft key light)",
  },
  {
    title: "Harbor Documentary",
    icon: "videocam",
    prompt: "At dawn on a wet concrete pier, a marine biologist in a yellow oilskin jacket hauls up a brass water-sampling cylinder from the harbor while fishing trawlers idle in the background fog.",
    style: "Documentary Realism (handheld 24mm, available natural light)",
  },
  {
    title: "Night Diner Transit",
    icon: "directions_car",
    prompt: "A long-haul truck driver sits at a formica counter in a roadside diner at 2 AM, stirring black coffee under warm tungsten pendant lamps as headlights sweep across the front window.",
    style: "35mm Film (Arri Alexa, natural grain, practical lighting)",
  },
  {
    title: "Archive Investigation",
    icon: "menu_book",
    prompt: "In a basement municipal archive lined with steel shelving, a journalist photographs a 1974 zoning map under a desk lamp while a wall clock ticks in the quiet room.",
    style: "Low-Key Noir (hard tungsten key light, deep shadows, 50mm prime)",
  },
  {
    title: "Watchmaker Bench",
    icon: "photo_camera",
    prompt: "Close tabletop sequence of a horologist fitting a brass balance wheel into a mechanical wristwatch movement using fine tweezers under a directional workbench lamp.",
    style: "1970s Kodachrome (warm film stock, soft halation, 35mm prime)",
  },
];

const VIDEO_DURATIONS = [4, 5, 6, 8, 10];
const VIDEO_RESOLUTIONS = ["auto", "720p", "1080p"];
const CHARACTER_VIEWS = ["front", "back", "left", "right"];
const CHARACTER_VIEW_LABEL = { front: "Depan", back: "Belakang", left: "Kiri", right: "Kanan" };
const CHARACTER_STATUS_VARIANT = { draft: "default", generating: "info", ready: "success", failed: "error" };

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

  const [videoDuration, setVideoDuration] = useState(5);
  const [videoAspect, setVideoAspect] = useState("16:9");
  const [videoResolution, setVideoResolution] = useState("auto");
  const [directorPersona, setDirectorPersona] = useState("huobao_drama");
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);

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

  // Flow Characters (CRUD + 4-angle reference sheet)
  const [flowCharacters, setFlowCharacters] = useState([]);
  const [flowCharForm, setFlowCharForm] = useState({ name: "", description: "", style: "", imageModel: "" });
  const [editingFlowCharId, setEditingFlowCharId] = useState(null);
  const [editingFlowCharDraft, setEditingFlowCharDraft] = useState({ name: "", description: "", style: "", imageModel: "" });
  const [flowCharCreating, setFlowCharCreating] = useState(false);
  const [flowCharSavingId, setFlowCharSavingId] = useState("");
  const [flowCharBusyId, setFlowCharBusyId] = useState("");
  const [flowCharError, setFlowCharError] = useState("");
  const [showFlowCharModelModal, setShowFlowCharModelModal] = useState(false);
  const [selectedRefCharLabel, setSelectedRefCharLabel] = useState("");

  // Render / Combine Videos state
  const [renderSelectedIndices, setRenderSelectedIndices] = useState([]);
  const [renderingCombined, setRenderingCombined] = useState(false);
  const [combinedVideoUrl, setCombinedVideoUrl] = useState("");
  const [combinedVideoMeta, setCombinedVideoMeta] = useState(null);
  const [renderError, setRenderError] = useState("");

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

  const loadFlowCharacters = useCallback(async () => {
    try {
      const res = await fetch("/api/flow/characters");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFlowCharacters(data.characters || []);
      }
    } catch (e) {
      console.error("Failed to load flow characters", e);
    }
  }, []);

  // Load initial environment data
  useEffect(() => {
    (async () => {
      try {
        const [keysRes, providersRes, aliasesRes, projectsRes, flowCharsRes] = await Promise.all([
          fetch("/api/keys"),
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/video-prompt/projects"),
          fetch("/api/flow/characters"),
        ]);
        const keysData = await keysRes.json().catch(() => ({}));
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = await aliasesRes.json().catch(() => ({}));
        const projectsData = await projectsRes.json().catch(() => ({}));
        const flowCharsData = await flowCharsRes.json().catch(() => ({}));

        setApiKey((keysData.keys || []).find((k) => k.isActive !== false)?.key || "");
        setActiveProviders(providersData.connections || []);
        setModelAliases(aliasesData.aliases || {});
        setFlowCharacters(flowCharsData.characters || []);
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

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e) => {
      if (e.key === "Escape") setLightboxImage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage]);

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
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/") && !url.startsWith("/api/flow/images/")) {
      setError("Reference URL must start with http://, https://, /api/flow/images/, or data:image/");
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

  // Flow Character CRUD + 4-angle generation
  const handleCreateFlowCharacter = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!flowCharForm.name.trim()) return;
    setFlowCharError("");
    setFlowCharCreating(true);
    try {
      const res = await fetch("/api/flow/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: flowCharForm.name.trim(),
          description: flowCharForm.description.trim(),
          style: flowCharForm.style.trim(),
          imageModel: flowCharForm.imageModel || imageModel || "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal membuat karakter");
      setFlowCharForm({ name: "", description: "", style: "", imageModel: flowCharForm.imageModel });
      await loadFlowCharacters();
    } catch (err) {
      setFlowCharError(String(err.message || err));
    } finally {
      setFlowCharCreating(false);
    }
  };

  const handleStartEditFlowCharacter = (character) => {
    setEditingFlowCharId(character.id);
    setEditingFlowCharDraft({
      name: character.name || "",
      description: character.description || "",
      style: character.style || "",
      imageModel: character.imageModel || imageModel || "",
    });
  };

  const handleSaveEditFlowCharacter = async (id) => {
    if (!editingFlowCharDraft.name.trim()) return;
    setFlowCharError("");
    setFlowCharSavingId(id);
    try {
      const res = await fetch(`/api/flow/characters/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingFlowCharDraft.name.trim(),
          description: editingFlowCharDraft.description.trim(),
          style: editingFlowCharDraft.style.trim(),
          imageModel: editingFlowCharDraft.imageModel || imageModel || "",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal memperbarui karakter");
      setEditingFlowCharId(null);
      await loadFlowCharacters();
    } catch (err) {
      setFlowCharError(String(err.message || err));
    } finally {
      setFlowCharSavingId("");
    }
  };

  const handleDeleteFlowCharacter = async (character) => {
    if (!window.confirm(`Hapus karakter "${character.name}" beserta ${character.images?.length || 0} gambarnya?`)) return;
    setFlowCharError("");
    try {
      const res = await fetch(`/api/flow/characters/${character.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Gagal menghapus karakter");
      }
      if (editingFlowCharId === character.id) setEditingFlowCharId(null);
      await loadFlowCharacters();
    } catch (err) {
      setFlowCharError(String(err.message || err));
    }
  };

  const handleGenerateFlowCharacterViews = async (character, views = CHARACTER_VIEWS) => {
    const chosenModel = flowCharForm.imageModel || character.imageModel || imageModel;
    if (!chosenModel) {
      setFlowCharError("Pilih model gambar terlebih dahulu sebelum generate sudut karakter");
      return;
    }
    setFlowCharError("");
    setFlowCharBusyId(character.id);
    try {
      const res = await fetch(`/api/flow/characters/${character.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views, model: chosenModel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Generate karakter gagal");
      if (body.errors?.length) setFlowCharError(`${character.name}: ${body.errors.join(" | ")}`);
      await loadFlowCharacters();
    } catch (err) {
      setFlowCharError(String(err.message || err));
    } finally {
      setFlowCharBusyId("");
    }
  };

  const handleSelectFlowCharacterRef = (character, image = null) => {
    const targetImg = image || (character.images || [])[0] || null;
    if (targetImg) {
      const url = `/api/flow/images/${targetImg.id}`;
      setRefImage(url);
      setRefUrlDraft("");
      const viewLabel = targetImg.view ? ` (${CHARACTER_VIEW_LABEL[targetImg.view] || targetImg.view})` : "";
      setSelectedRefCharLabel(`${character.name}${viewLabel}`);
    } else {
      setSelectedRefCharLabel(character.name);
    }
    if (character.description) {
      setCharacterDesc(
        `${character.name}: ${character.description}${character.style ? ` (${character.style})` : ""}`
      );
    }
    setError("");
  };

  // Auto-select ready video scenes when scenes update
  useEffect(() => {
    const readyIndices = scenes
      .map((s, idx) => (s.videoUrl && !videoErrors[idx] ? idx : -1))
      .filter((idx) => idx !== -1);
    setRenderSelectedIndices(readyIndices);
  }, [scenes, videoErrors]);

  const handleToggleRenderScene = (idx) => {
    setRenderSelectedIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b)
    );
  };

  const handleCombineVideos = async () => {
    const selectedClips = renderSelectedIndices
      .map((idx) => scenes[idx])
      .filter((s) => s && s.videoUrl);
    if (selectedClips.length === 0) {
      setRenderError("Pilih minimal 1 video shot yang sudah selesai dirender");
      return;
    }
    setRenderingCombined(true);
    setRenderError("");
    try {
      const res = await fetch("/api/video-prompt/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: selectedClips.map((s) => ({
            sceneNumber: s.sceneNumber,
            videoUrl: getPlayableVideoUrl(s.videoUrl),
          })),
          aspectRatio: videoAspect || aspectRatio,
          resolution: videoResolution,
          projectId: currentProjectId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal menggabungkan video");
      setCombinedVideoUrl(data.videoUrl);
      setCombinedVideoMeta({ id: data.id, clipCount: data.clipCount, size: data.size });
    } catch (err) {
      setRenderError(String(err.message || err));
    } finally {
      setRenderingCombined(false);
    }
  };

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
      const systemPrompt = `You are a script breakdown assistant. Extract the primary characters from the provided story concept.
${ANTISLOP_CHARACTER_EXTRACT_DIRECTIVE}
Return a valid JSON array ONLY with keys: "name", "role" (Lead, Antagonist, Supporting, Mentor, Cameo), and "description" (age range, build, hair, wardrobe, props).
Example format:
[
  {"name": "Rina Kartika", "role": "Lead", "description": "Late 20s forensic auditor, tied-back black hair, charcoal wool blazer, carrying a stamped ledger"}
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

      const authHeaders = { "Content-Type": "application/json" };
      if (apiKey) authHeaders.Authorization = `Bearer ${apiKey}`;

      const res = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: authHeaders,
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
          name: sanitizeAntislopText(c.name || "") || `Character ${i + 1}`,
          role: sanitizeAntislopText(c.role || "") || "Lead",
          description: sanitizeAntislopText(c.description || ""),
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
          negativePrompt,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate video storyboard");
      }

      setProjectTitle(data.projectTitle || "Untitled Storyboard");
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
      const reqBody = {
        prompt: fullPrompt,
        model: imageModel,
        aspectRatio,
        image: refImage || undefined,
        negativePrompt,
      };
      reqBody["apiKey"] = apiKey;
      const res = await fetch("/api/video-prompt/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
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
      const reqBody = {
        model: videoModel,
        prompt: targetScene.motionPrompt || targetScene.summary,
        image: targetScene.imageUrl || undefined,
        duration: videoDuration,
        aspectRatio: videoAspect,
        resolution: videoResolution,
        negativePrompt,
      };
      reqBody["apiKey"] = apiKey;
      const res = await fetch("/api/video-prompt/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
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
        [sceneIndex]: { status: "processing", step: data.step || "", requestId, connectionId, error: "" },
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
            setVideoGenStates((prev) => ({ ...prev, [sceneIndex]: { status: "completed", step: "", error: "" } }));
          } else if (pollData.status === "failed") {
            clearInterval(pollInterval);
            setVideoGenStates((prev) => ({
              ...prev,
              [sceneIndex]: { status: "failed", step: pollData.step || "", error: pollData.error || "Video rendering failed" },
            }));
          } else if (pollData.step) {
            setVideoGenStates((prev) => ({
              ...prev,
              [sceneIndex]: { ...prev[sceneIndex], step: pollData.step },
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
      <header className="shrink-0 z-20 border-b border-border bg-surface">
        <div className="flex items-center justify-between gap-2 sm:gap-3 px-3 sm:px-5 h-13 sm:h-14">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="size-8 sm:size-9 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shrink-0">
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
                    className="h-7 sm:h-8 w-36 sm:w-60 text-xs sm:text-sm font-semibold bg-surface-2 border border-primary rounded-md px-2 focus-visible:outline-2 focus-visible:outline-primary text-text-main"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(true)}
                    className="group flex items-center gap-1 min-h-[32px] max-w-[130px] sm:max-w-xs text-xs sm:text-sm font-semibold tracking-tight text-left rounded-md hover:text-primary focus-visible:outline-2 focus-visible:outline-primary transition-colors"
                    title="Rename project"
                  >
                    <span className="truncate">{projectTitle || "Untitled Storyboard"}</span>
                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] text-text-muted shrink-0" aria-hidden="true">
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
          <nav aria-label="Studio workflow" className="grid grid-cols-6 sm:flex sm:items-center gap-1 sm:gap-2 w-full sm:w-auto min-w-0">
            {[
              { id: "story", icon: "menu_book", label: "Story" },
              { id: "characters", icon: "person", label: "Character", count: flowCharacters.length + characters.length },
              { id: "storyboard", icon: "grid_view", label: "Shots", count: scenes.length },
              { id: "studio", icon: "videocam", label: "Director" },
              { id: "render", icon: "movie_creation", label: "Render", count: videosReadyCount },
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
                  {i < 5 && (
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

      <div className="flex flex-1 min-h-0 h-full overflow-hidden relative">
        {activeTab === "story" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-[15px]">movie</span>
                    Scene Starters
                  </span>
                  <span className="text-[11px] text-text-muted">Load sample production brief</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
                  {INSPIRATION_TEMPLATES.map((tmpl) => (
                    <button
                      key={tmpl.title}
                      type="button"
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="p-2.5 rounded-xl border border-border bg-surface hover:border-primary/50 text-left transition-colors group flex flex-col justify-between focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-main group-hover:text-primary">
                        <span className="material-symbols-outlined text-[16px] text-primary">{tmpl.icon}</span>
                        <span className="truncate">{tmpl.title}</span>
                      </div>
                      <p className="text-[11px] text-text-muted line-clamp-2 mt-1 leading-relaxed">
                        {tmpl.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5 rounded-xl bg-surface border border-border space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">movie_edit</span>
                      Script & Scene Concept
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Write the scene sequence, setting, and physical actions to break into shots
                    </p>
                  </div>
                  {prompt && (
                    <button
                      type="button"
                      onClick={() => setPrompt("")}
                      className="text-xs text-text-muted hover:text-destructive flex items-center gap-1 px-2 py-1 rounded-md focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[14px]">clear</span>
                      Clear Text
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <textarea
                    rows={6}
                    aria-label="Storyline and script concept"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Write the scene sequence, setting, characters, and camera beats..."
                    className="w-full text-sm bg-surface border border-border rounded-xl p-3.5 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary transition-colors resize-y placeholder:text-text-muted leading-relaxed font-sans"
                  />
                  <div className="flex justify-between text-xs text-text-muted px-1">
                    <span>One paragraph or beat per shot works best</span>
                    <span>{prompt.length} characters</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/70">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">palette</span>
                      Camera & Lighting Preset
                    </label>
                    <select
                      value={style}
                      onChange={(e) => setStyle(e.target.value)}
                      className="w-full text-xs bg-surface border border-border rounded-xl px-3 py-2.5 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary cursor-pointer text-text-main"
                    >
                      {STYLES.map((s) => (
                        <option key={s.id} value={s.label}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">smart_display</span>
                      Target Video Engine
                    </label>
                    <select
                      value={targetEngine}
                      onChange={(e) => setTargetEngine(e.target.value)}
                      className="w-full text-xs bg-surface border border-border rounded-xl px-3 py-2.5 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary cursor-pointer text-text-main"
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
                <div className="space-y-3 pt-2 border-t border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-medium text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">face</span>
                      Reference Character / Keyframe Image (Optional)
                    </label>
                    <div className="flex items-center gap-2">
                      {selectedRefCharLabel && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                          Karakter: {selectedRefCharLabel}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveTab("characters")}
                        className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <span className="material-symbols-outlined text-[13px]">person_add</span>
                        Kelola Character ({flowCharacters.length})
                      </button>
                      {refImage && (
                        <button
                          type="button"
                          onClick={() => {
                            clearRefImage();
                            setSelectedRefCharLabel("");
                          }}
                          className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[13px]">delete</span>
                          Remove Image
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Saved Flow Characters Picker */}
                  {flowCharacters.length > 0 && (
                    <div className="p-3 rounded-xl bg-surface-2/50 border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-text-main flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-primary">badge</span>
                          Pilih Karakter Tersimpan
                        </span>
                        <span className="text-[10px] text-text-muted">Klik sudut atau karakter untuk jadikan referensi</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                        {flowCharacters.map((fc) => {
                          const imgs = fc.images || [];
                          const firstImg = imgs[0];
                          const isSelectedChar =
                            selectedRefCharLabel.startsWith(fc.name) ||
                            imgs.some((im) => refImage === `/api/flow/images/${im.id}`);
                          return (
                            <div
                              key={fc.id}
                              className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                                isSelectedChar
                                  ? "bg-primary/10 border-primary shadow-xs"
                                  : "bg-surface border-border hover:border-primary/40"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {firstImg ? (
                                    <img
                                      src={`/api/flow/images/${firstImg.id}`}
                                      alt={fc.name}
                                      className="h-10 w-10 rounded-lg object-cover border border-border shrink-0"
                                    />
                                  ) : (
                                    <div className="h-10 w-10 rounded-lg bg-surface-2 border border-border text-text-main flex items-center justify-center font-bold text-xs shrink-0">
                                      {fc.name[0]?.toUpperCase() || "C"}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-text-main truncate">{fc.name}</p>
                                    <p className="text-[10px] text-text-muted line-clamp-1">
                                      {fc.description || fc.style || "Tanpa deskripsi"}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectFlowCharacterRef(fc, firstImg)}
                                    className="px-2 py-1 rounded-md text-[10px] font-semibold bg-primary text-white hover:opacity-90"
                                  >
                                    Pilih
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleStartEditFlowCharacter(fc);
                                      setActiveTab("characters");
                                    }}
                                    className="p-1 rounded text-text-muted hover:text-text-main"
                                    title="Edit karakter"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteFlowCharacter(fc)}
                                    className="p-1 rounded text-text-muted hover:text-destructive"
                                    title="Hapus karakter"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">delete</span>
                                  </button>
                                </div>
                              </div>
                              {imgs.length > 0 && (
                                <div className="flex items-center gap-1.5 pt-1 border-t border-border/60">
                                  {imgs.map((im) => {
                                    const imgUrl = `/api/flow/images/${im.id}`;
                                    const activeAngle = refImage === imgUrl;
                                    return (
                                      <button
                                        key={im.id}
                                        type="button"
                                        onClick={() => handleSelectFlowCharacterRef(fc, im)}
                                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] transition-all ${
                                          activeAngle
                                            ? "bg-primary text-white border-primary font-semibold"
                                            : "bg-surface-2 border-border text-text-muted hover:text-text-main"
                                        }`}
                                      >
                                        <img src={imgUrl} alt={im.view || ""} className="h-4 w-4 rounded-xs object-cover" />
                                        <span>{CHARACTER_VIEW_LABEL[im.view] || im.view || "Frame"}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                      <div className="relative h-20 w-28 rounded-xl overflow-hidden border border-border bg-black/40 shrink-0 group">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={refImage} alt="Reference keyframe preview" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setLightboxImage(refImage)}
                          aria-label="Preview reference image"
                          className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-white hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      aria-label="Reference image URL"
                      placeholder="https://example.com/reference.png"
                      value={refUrlDraft}
                      onChange={(e) => setRefUrlDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applyRefUrl()}
                      className="flex-1 text-xs bg-surface border border-border rounded-xl px-3 py-1.5 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
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

                <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/70">
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>Script Model:</span>
                    <button
                      type="button"
                      onClick={() => setShowLlmModal(true)}
                      className="px-2.5 py-1 rounded-lg bg-surface-2 border border-border text-primary font-semibold hover:border-primary focus-visible:outline-2 focus-visible:outline-primary transition-colors flex items-center gap-1"
                    >
                      <span className="truncate max-w-[160px]">{llmModel || "Select LLM Model"}</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_drop_down</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <Button
                      variant="primary"
                      size="md"
                      icon="movie_edit"
                      loading={generating}
                      onClick={handleGenerateStoryboard}
                      disabled={generating || !prompt.trim()}
                      className="w-full sm:w-auto px-6 font-semibold"
                    >
                      Generate Storyboard
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

        {activeTab === "characters" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              <div className="p-5 rounded-xl bg-surface border border-border space-y-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">person</span>
                      Character Turnaround Sheet (Google Flow)
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Buat karakter dengan 4 sudut referensi (Depan, Belakang, Kiri, Kanan) dan pilih langsung di Reference Character / Keyframe Image
                    </p>
                  </div>
                </div>

                <form onSubmit={handleCreateFlowCharacter} className="space-y-3 p-4 rounded-xl bg-surface-2/60 border border-border">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-semibold text-text-muted">Nama Karakter *</label>
                      <input
                        type="text"
                        required
                        value={flowCharForm.name}
                        onChange={(e) => setFlowCharForm({ ...flowCharForm, name: e.target.value })}
                        placeholder="Nama karakter"
                        className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-text-muted">Style Visual</label>
                      <input
                        type="text"
                        value={flowCharForm.style}
                        onChange={(e) => setFlowCharForm({ ...flowCharForm, style: e.target.value })}
                        placeholder="35mm film, 2D cel animation, 3D stylized"
                        className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Deskripsi Karakter</label>
                    <input
                      type="text"
                      value={flowCharForm.description}
                      onChange={(e) => setFlowCharForm({ ...flowCharForm, description: e.target.value })}
                      placeholder="Usia, postur, gaya rambut, pakaian, properti utama"
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      icon="image"
                      onClick={() => setShowFlowCharModelModal(true)}
                    >
                      {flowCharForm.imageModel || imageModel || "Pilih model gambar"}
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      icon="add"
                      loading={flowCharCreating}
                      disabled={!flowCharForm.name.trim()}
                    >
                      Simpan Karakter
                    </Button>
                  </div>
                </form>

                {flowCharError && (
                  <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-2">
                    <span>{flowCharError}</span>
                    <button type="button" onClick={() => setFlowCharError("")} className="hover:opacity-75">
                      <span className="material-symbols-outlined text-[15px]">close</span>
                    </button>
                  </div>
                )}

                {/* Saved Flow Characters List (CRUD + 4-View Grid) */}
                {flowCharacters.length === 0 ? (
                  <div className="text-center py-8 border-2 border-dashed border-border rounded-2xl text-text-muted text-xs space-y-1">
                    <span className="material-symbols-outlined text-[32px] text-primary/60">face</span>
                    <p className="font-medium text-text-main">Belum ada karakter tersimpan</p>
                    <p className="text-[11px] text-text-muted">Buat karakter baru di atas untuk generate 4 sudut gambar referensi.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {flowCharacters.map((fc) => {
                      const byView = new Map((fc.images || []).map((img) => [img.view, img]));
                      const isGenerating = flowCharBusyId === fc.id || fc.status === "generating";
                      const isEditing = editingFlowCharId === fc.id;
                      return (
                        <div key={fc.id} className="p-4 rounded-xl bg-surface border border-border space-y-3 shadow-xs">
                          {isEditing ? (
                            <div className="space-y-3 p-3 rounded-xl bg-surface-2/60 border border-border">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="text-[11px] font-semibold text-text-muted">Nama Karakter *</label>
                                  <input
                                    type="text"
                                    value={editingFlowCharDraft.name}
                                    onChange={(e) =>
                                      setEditingFlowCharDraft({ ...editingFlowCharDraft, name: e.target.value })
                                    }
                                    className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                                  />
                                </div>
                                <div>
                                  <label className="text-[11px] font-semibold text-text-muted">Style Visual</label>
                                  <input
                                    type="text"
                                    value={editingFlowCharDraft.style}
                                    onChange={(e) =>
                                      setEditingFlowCharDraft({ ...editingFlowCharDraft, style: e.target.value })
                                    }
                                    className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-[11px] font-semibold text-text-muted">Deskripsi</label>
                                <input
                                  type="text"
                                  value={editingFlowCharDraft.description}
                                  onChange={(e) =>
                                    setEditingFlowCharDraft({ ...editingFlowCharDraft, description: e.target.value })
                                  }
                                  className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                                />
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setEditingFlowCharId(null)}
                                >
                                  Batal
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="xs"
                                  loading={flowCharSavingId === fc.id}
                                  onClick={() => handleSaveEditFlowCharacter(fc.id)}
                                >
                                  Simpan Perubahan
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="text-xs font-bold text-text-main">{fc.name}</h3>
                                  <Badge variant={CHARACTER_STATUS_VARIANT[fc.status] || "default"} dot>
                                    {fc.status}
                                  </Badge>
                                  {fc.style && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-surface-2 border border-border text-text-muted">
                                      {fc.style}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-text-muted mt-1">{fc.description || "Tanpa deskripsi"}</p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  icon="check_circle"
                                  onClick={() => {
                                    handleSelectFlowCharacterRef(fc);
                                    setActiveTab("story");
                                  }}
                                >
                                  Pakai di Reference
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  icon="edit"
                                  onClick={() => handleStartEditFlowCharacter(fc)}
                                  aria-label={`Edit ${fc.name}`}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  icon="delete"
                                  onClick={() => handleDeleteFlowCharacter(fc)}
                                  aria-label={`Hapus ${fc.name}`}
                                />
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {CHARACTER_VIEWS.map((view) => {
                              const image = byView.get(view);
                              return (
                                <div key={view} className="space-y-1.5">
                                  {image ? (
                                    <>
                                      <div className="relative group/angle">
                                        <img
                                          src={`/api/flow/images/${image.id}`}
                                          alt={`${fc.name} ${CHARACTER_VIEW_LABEL[view]}`}
                                          className="aspect-[3/4] w-full rounded-xl border border-border object-cover"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setLightboxImage(`/api/flow/images/${image.id}`)}
                                          className="absolute top-2 right-2 p-1 rounded-lg bg-black/70 text-white hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-primary"
                                          title="Zoom"
                                          aria-label={`Zoom ${fc.name} ${CHARACTER_VIEW_LABEL[view]}`}
                                        >
                                          <span className="material-symbols-outlined text-[14px]">zoom_in</span>
                                        </button>
                                      </div>
                                      <div className="flex gap-1">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="xs"
                                          className="flex-1"
                                          onClick={() => {
                                            handleSelectFlowCharacterRef(fc, image);
                                            setActiveTab("story");
                                          }}
                                        >
                                          Pakai
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="xs"
                                          icon="refresh"
                                          disabled={isGenerating}
                                          onClick={() => handleGenerateFlowCharacterViews(fc, [view])}
                                          aria-label={`Regenerate ${view}`}
                                        />
                                      </div>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={isGenerating}
                                      onClick={() => handleGenerateFlowCharacterViews(fc, [view])}
                                      className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-surface-2/60 text-text-muted hover:border-primary/50 disabled:opacity-50"
                                    >
                                      <span className="material-symbols-outlined text-[22px]">add_photo_alternate</span>
                                      <span className="text-xs">{isGenerating ? "…" : CHARACTER_VIEW_LABEL[view]}</span>
                                    </button>
                                  )}
                                  <p className="text-center text-[11px] text-text-muted">{CHARACTER_VIEW_LABEL[view]}</p>
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              type="button"
                              variant="primary"
                              size="xs"
                              icon="grid_view"
                              loading={isGenerating}
                              onClick={() => handleGenerateFlowCharacterViews(fc, CHARACTER_VIEWS)}
                            >
                              Generate 4 Sudut
                            </Button>
                            <span className="text-[11px] text-text-muted">
                              Model: {fc.imageModel || flowCharForm.imageModel || imageModel || "belum dipilih"}
                            </span>
                            {fc.error && <span className="w-full text-xs text-destructive">{fc.error}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-5 rounded-xl bg-surface border border-border space-y-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">groups</span>
                      Script Cast & Continuity Notes
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Define character appearance and wardrobe notes shared across all generated shots
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {prompt.trim() && (
                      <Button
                        variant="outline"
                        size="sm"
                        icon="person_search"
                        loading={extractingChars}
                        onClick={handleAutoExtractCharacters}
                        title="Extract characters mentioned in the script"
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-surface-2/60 border border-border">
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Character Name *</label>
                    <input
                      type="text"
                      value={newCharName}
                      onChange={(e) => setNewCharName(e.target.value)}
                      placeholder="Character name"
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-text-muted">Role / Archetype</label>
                    <select
                      value={newCharRole}
                      onChange={(e) => setNewCharRole(e.target.value)}
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main cursor-pointer"
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
                      placeholder="Age range, build, hair, wardrobe, key props"
                      className="w-full mt-1 text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary text-text-main"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-text-muted">
                      Active Cast ({characters.length})
                    </h3>
                    <span className="text-[11px] text-text-muted">
                      Included in every image and video prompt
                    </span>
                  </div>

                  {characters.length === 0 ? (
                    <div className="text-center py-10 border-2 border-dashed border-border rounded-xl text-text-muted text-xs space-y-2">
                      <span className="material-symbols-outlined text-[32px] text-primary/60">person_search</span>
                      <p className="font-medium text-text-main">No Cast Members Added</p>
                      <p className="text-[11px] text-text-muted max-w-sm mx-auto">
                        Add characters above or use &quot;Extract from Script&quot; to pull them from your story concept.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {characters.map((char) => (
                        <div
                          key={char.id}
                          className="p-4 rounded-xl bg-surface border border-border hover:border-primary/50 transition-colors space-y-2.5 relative group"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-lg bg-surface-2 border border-border text-text-main flex items-center justify-center font-bold text-sm">
                                {char.name[0]?.toUpperCase() || "C"}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-text-main">{char.name}</h4>
                                <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                                  {char.role}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteCharacter(char.id)}
                              className="text-text-muted hover:text-destructive p-1 rounded focus-visible:outline-2 focus-visible:outline-primary"
                              title="Delete character"
                              aria-label={`Delete ${char.name}`}
                            >
                              <span className="material-symbols-outlined text-[16px]">close</span>
                            </button>
                          </div>
                          <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                            {char.description || "No visual traits specified."}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-4 border-t border-border/70">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-text-muted flex items-center gap-1">
                      <span className="material-symbols-outlined text-[15px] text-primary">lock_reset</span>
                      Character Continuity Prompt
                    </label>
                    <span className="text-[11px] text-text-muted">Appended to each shot generation</span>
                  </div>
                  <textarea
                    rows={3}
                    aria-label="Character continuity prompt"
                    value={characterConsistencyPrompt}
                    onChange={(e) => setCharacterConsistencyPrompt(e.target.value)}
                    placeholder="Shared physical and wardrobe notes appended to every keyframe and video prompt..."
                    className="w-full text-xs bg-surface border border-border rounded-xl p-3 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary font-mono leading-relaxed"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "storyboard" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border bg-surface shrink-0 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">grid_view</span>
                    {projectTitle || "Storyboard Shots"}
                  </h2>
                  <span className="text-xs text-text-muted font-mono">
                    ({scenes.length} Shots • ~{scenes.length * 5}s runtime)
                  </span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  Style: <span className="text-text-main font-medium">{style.split("(")[0]}</span> • Engine:{" "}
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

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6">
              {scenes.length === 0 ? (
                <div className="text-center py-16 border-2 border-dashed border-border rounded-xl text-text-muted text-xs space-y-3 max-w-lg mx-auto">
                  <span className="material-symbols-outlined text-[40px] text-primary/50">movie_edit</span>
                  <h3 className="text-base font-semibold text-text-main">No Storyboard Shots Yet</h3>
                  <p className="text-xs text-text-muted max-w-sm mx-auto">
                    Open the Story tab, enter your script concept, and generate shots.
                  </p>
                  <div className="pt-2">
                    <Button variant="primary" size="sm" onClick={() => setActiveTab("story")}>
                      Open Story Input
                    </Button>
                  </div>
                </div>
              ) : storyboardViewMode === "grid" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {scenes.map((scene, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-xl border transition-colors flex flex-col justify-between group ${
                        selectedSceneIndex === idx
                          ? "bg-surface border-primary ring-1 ring-primary/25"
                          : "bg-surface border-border hover:border-primary/40"
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
                                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-white hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-primary"
                                title="Zoom Image"
                                aria-label={`Zoom Shot ${idx + 1}`}
                              >
                                <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                              </button>
                            </div>
                          ) : (
                            <div className="text-center text-text-muted p-4">
                              <span className="material-symbols-outlined text-[32px]">image</span>
                              <p className="text-[11px] mt-1">No media rendered</p>
                              <button
                                type="button"
                                onClick={() => handleGenerateImage(idx)}
                                className="mt-2 px-2.5 py-1 rounded-md text-[11px] bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                              >
                                Generate First Frame
                              </button>
                            </div>
                          )}
                        </div>

                        <h4 className="text-xs font-semibold text-text-main line-clamp-2 leading-snug">
                          {scene.summary}
                        </h4>

                        <div className="p-2.5 pr-8 rounded-xl bg-surface-2/60 border border-border text-[11px] text-text-muted line-clamp-2 font-mono leading-relaxed relative">
                          {scene.motionPrompt}
                          <button
                            type="button"
                            onClick={() => copy(scene.motionPrompt)}
                            className="absolute top-1.5 right-1.5 p-1 rounded bg-surface border border-border text-text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                            title="Copy Motion Prompt"
                            aria-label={`Copy Shot ${idx + 1} Motion Prompt`}
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
                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-surface-2 text-text-muted font-semibold text-xs">
                          <th className="py-3 px-4 w-16">Shot</th>
                          <th className="py-3 px-4 w-32">Preview</th>
                          <th className="py-3 px-4">Summary &amp; Prompts</th>
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

        {activeTab === "studio" && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            <div className="w-full lg:w-64 max-h-48 lg:max-h-none border-b lg:border-b-0 lg:border-r border-border bg-surface/40 overflow-y-auto custom-scrollbar p-3 space-y-2 shrink-0 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-text-muted">
                    Filmstrip ({scenes.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddShot}
                    className="text-xs text-primary hover:underline flex items-center gap-0.5 font-medium focus-visible:outline-2 focus-visible:outline-primary"
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
                      className={`p-2 rounded-xl border text-left cursor-pointer transition-colors flex items-center gap-2.5 ${
                        selectedSceneIndex === idx
                          ? "bg-surface border-primary text-text-main ring-1 ring-primary/20"
                          : "bg-surface border-border/80 text-text-muted hover:border-primary/40"
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
                    {(studioMonitorMode === "split" || studioMonitorMode === "image") && (
                      <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
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
                              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                                <Button
                                  variant="primary"
                                  size="xs"
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
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-surface border border-border text-text-main hover:bg-surface-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                                >
                                  <span className="material-symbols-outlined text-[15px]">download</span>
                                  Download
                                </a>
                              </div>
                            </>
                          ) : (
                            <div className="text-center text-text-muted p-4">
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

                    {(studioMonitorMode === "split" || studioMonitorMode === "video") && (
                      <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold flex items-center gap-1.5 text-text-main">
                            <span className="material-symbols-outlined text-primary text-[16px]">movie</span>
                            Video Clip
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
                            <div className="text-center text-text-muted p-4">
                              <span className="material-symbols-outlined text-[36px]">videocam_off</span>
                              <p className="text-xs mt-1">Video clip not rendered yet</p>
                              {videoGenStates[selectedSceneIndex]?.status === "processing" && (
                                <p className="text-xs text-primary font-medium mt-1">
                                  {videoGenStates[selectedSceneIndex]?.step
                                    ? `Rendering (${videoGenStates[selectedSceneIndex].step})...`
                                    : "Rendering video clip..."}
                                </p>
                              )}
                              {videoGenStates[selectedSceneIndex]?.error && (
                                <p className="text-[11px] text-destructive mt-1.5 max-w-xs mx-auto">
                                  {videoGenStates[selectedSceneIndex].error}
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

        {/* TAB 5: RENDER & MERGE VIDEOS */}
        {activeTab === "render" && (
          <div className="flex-1 flex overflow-y-auto custom-scrollbar p-4 sm:p-6 justify-center">
            <div className="max-w-4xl w-full space-y-5">
              <div className="p-5 rounded-2xl bg-surface border border-border shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">movie_creation</span>
                      Final Render & Gabungkan Semua Video
                    </h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      Pilih urutan shot yang sudah memiliki video clip lalu gabungkan menjadi satu video MP4 utuh
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const allReady = scenes
                          .map((s, idx) => (s.videoUrl && !videoErrors[idx] ? idx : -1))
                          .filter((idx) => idx !== -1);
                        setRenderSelectedIndices(allReady);
                      }}
                    >
                      Pilih Semua Ready ({videosReadyCount})
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      icon="merge"
                      loading={renderingCombined}
                      disabled={renderingCombined || renderSelectedIndices.length === 0}
                      onClick={handleCombineVideos}
                    >
                      Gabungkan Video ({renderSelectedIndices.length} Clip)
                    </Button>
                  </div>
                </div>

                {renderError && (
                  <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
                      <span>{renderError}</span>
                    </div>
                    <button type="button" onClick={() => setRenderError("")} className="hover:opacity-75">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                )}

                {/* Combined Output Video Player */}
                {combinedVideoUrl && (
                  <div className="p-4 rounded-2xl bg-surface-2/60 border border-primary/40 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                          Render Selesai
                        </span>
                        <span className="text-xs font-semibold text-text-main">
                          {projectTitle || "Final Combined Video"} ({combinedVideoMeta?.clipCount || renderSelectedIndices.length} Shots)
                        </span>
                      </div>
                      <a
                        href={`${combinedVideoUrl}${combinedVideoUrl.includes("?") ? "&" : "?"}download=1`}
                        download={`${(projectTitle || "storyboard-final").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:opacity-90 transition-opacity"
                      >
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        Download Final MP4
                      </a>
                    </div>
                    <div className="aspect-video w-full max-w-2xl mx-auto rounded-xl bg-black overflow-hidden border border-border">
                      <video
                        key={combinedVideoUrl}
                        src={combinedVideoUrl}
                        controls
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                )}

                {/* Scene Clip Selection List */}
                {scenes.length === 0 ? (
                  <div className="text-center py-14 border-2 border-dashed border-border rounded-2xl text-text-muted text-xs space-y-2">
                    <span className="material-symbols-outlined text-[40px] text-primary/50">videocam_off</span>
                    <p className="font-medium text-text-main">Belum ada storyboard shot</p>
                    <p className="text-[11px] text-text-muted">Buat storyboard dan render video tiap shot terlebih dahulu di tab Shots atau Director.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-text-muted px-1">
                      <span>Daftar Shot ({videosReadyCount} dari {scenes.length} video siap digabung)</span>
                      <span>Urutan mengikuti nomor shot</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {scenes.map((sc, idx) => {
                        const hasVideo = Boolean(sc.videoUrl && !videoErrors[idx]);
                        const checked = renderSelectedIndices.includes(idx);
                        return (
                          <div
                            key={idx}
                            onClick={() => hasVideo && handleToggleRenderScene(idx)}
                            className={`p-3 rounded-xl border transition-all flex items-center gap-3 ${
                              !hasVideo
                                ? "bg-surface/40 border-border/60 opacity-60 cursor-not-allowed"
                                : checked
                                  ? "bg-primary/10 border-primary cursor-pointer shadow-xs"
                                  : "bg-surface border-border hover:border-primary/40 cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!hasVideo}
                              onChange={() => hasVideo && handleToggleRenderScene(idx)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 accent-primary rounded cursor-pointer"
                            />
                            <div className="h-14 w-24 rounded-lg bg-black/80 border border-border overflow-hidden shrink-0 flex items-center justify-center relative">
                              {hasVideo ? (
                                <video
                                  src={getPlayableVideoUrl(sc.videoUrl)}
                                  className="w-full h-full object-cover"
                                  muted
                                />
                              ) : sc.imageUrl ? (
                                <img src={sc.imageUrl} alt="" className="w-full h-full object-cover opacity-60" />
                              ) : (
                                <span className="material-symbols-outlined text-[18px] text-text-muted">videocam_off</span>
                              )}
                              <span className="absolute bottom-1 right-1 text-[9px] font-bold bg-black/75 text-white px-1.5 py-0.5 rounded">
                                #{sc.sceneNumber || idx + 1}
                              </span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-semibold text-text-main truncate">
                                  Shot #{sc.sceneNumber || idx + 1}
                                </span>
                                {hasVideo ? (
                                  <span className="text-[10px] font-semibold text-emerald-500">Ready</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSceneIndex(idx);
                                      setActiveTab("studio");
                                    }}
                                    className="text-[10px] text-primary hover:underline font-medium"
                                  >
                                    Render di Studio
                                  </button>
                                )}
                              </div>
                              <p className="text-[11px] text-text-muted line-clamp-2 mt-0.5">{sc.summary}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS GUI (FULL CONFIGURATOR) */}
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

        {historyOpen && (
          <aside className="w-80 border-l border-border bg-surface p-4 flex flex-col justify-between shrink-0 z-30">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-muted">
                  Saved Storyboards ({projects.length})
                </h3>
                <button
                  type="button"
                  aria-label="Close saved storyboards"
                  onClick={() => setHistoryOpen(false)}
                  className="text-text-muted hover:text-text-main p-1 rounded focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              <input
                type="text"
                aria-label="Search saved storyboards"
                placeholder="Search history..."
                value={searchHistory}
                onChange={(e) => setSearchHistory(e.target.value)}
                className="w-full text-xs bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              />

              <div className="space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-8 text-xs text-text-muted">No projects found</div>
                ) : (
                  filteredProjects.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectProject(p)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-colors relative group ${
                        currentProjectId === p.id
                          ? "bg-primary/10 border-primary text-text-main"
                          : "bg-surface border-border hover:border-primary/50 text-text-muted hover:text-text-main"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => handleDeleteProject(e, p.id)}
                        className="absolute top-2.5 right-2.5 text-text-muted hover:text-destructive p-0.5 rounded focus-visible:outline-2 focus-visible:outline-primary"
                        title="Delete project"
                        aria-label={`Delete ${p.title || "Untitled Storyboard"}`}
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

      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyframe high-resolution preview"
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-4xl w-full max-h-[90vh] overflow-hidden rounded-xl bg-surface border border-border p-4 flex flex-col justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-xs font-semibold">Keyframe Preview</span>
              <button
                type="button"
                aria-label="Close keyframe preview"
                onClick={() => setLightboxImage(null)}
                className="text-text-muted hover:text-text-main p-1 rounded focus-visible:outline-2 focus-visible:outline-primary"
              >
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

      <ModelSelectModal
        isOpen={showFlowCharModelModal}
        onClose={() => setShowFlowCharModelModal(false)}
        onSelect={(m) => {
          const modelVal = m?.value || m?.name || m;
          setFlowCharForm((prev) => ({ ...prev, imageModel: modelVal }));
          setShowFlowCharModelModal(false);
        }}
        selectedModel={flowCharForm.imageModel || imageModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        kindFilter="image"
        title="Pilih Model Gambar untuk Karakter"
      />
    </div>
  );
}
