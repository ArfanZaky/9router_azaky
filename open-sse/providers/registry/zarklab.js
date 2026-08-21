export default {
  id: "zarklab",
  priority: 70,
  hasFree: true,
  alias: "zarklab",
  aliases: [
    "zark",
    "zark-ai",
    "zarklab-ai",
  ],
  uiAlias: "zark",
  display: {
    name: "ZarkLab AI",
    icon: "movie_filter",
    color: "#6366F1",
    textIcon: "ZK",
    website: "https://www.zarklab.ai",
    notice: {
      apiKeyUrl: "https://www.zarklab.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: ["image", "video", "tts", "music"],
  transport: {
    baseUrl: "https://www.zarklab.ai/api/v1",
    thinkingFormat: "openai",
  },
  imageConfig: {
    baseUrl: "https://www.zarklab.ai/api/v1/images/generations",
  },
  videoConfig: {
    baseUrl: "https://www.zarklab.ai/api/v1/videos",
  },
  ttsConfig: {
    baseUrl: "https://www.zarklab.ai/api/v1/audio/speech",
  },
  musicConfig: {
    baseUrl: "https://www.zarklab.ai/api/v1/audio/music",
  },
  models: [
    // Image Models
    { id: "fal-gpt-image-2", name: "GPT Image 2", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-seedream-5-pro", name: "Seedream 5 Pro", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-seedream-5-lite", name: "Seedream 5 Lite", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-kling-image-o3", name: "Kling Image O3", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-nano-banana-pro", name: "Nano Banana Pro", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-nano-banana-2", name: "Nano Banana 2", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-nano-banana-2-lite", name: "Nano Banana 2 Lite", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-nano-banana-lite", name: "Nano Banana Lite", kind: "image", params: ["size", "aspect_ratio", "quality"] },
    { id: "fal-grok-image", name: "Grok Image", kind: "image", params: ["size", "aspect_ratio", "quality"] },

    // Video Models
    { id: "fal-veo-3-1", name: "Veo 3.1", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-veo-3-1-fast", name: "Veo 3.1 Fast", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-veo-3-1-lite", name: "Veo 3.1 Lite", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-gemini-omni-flash", name: "Gemini Omni Flash", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-seedance-2-5", name: "Seedance 2.5", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-seedance-2-fast", name: "Seedance 2 Lite", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-seedance-2-mini", name: "Seedance 2 Mini", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-seedance-2-pro", name: "Seedance 2", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-kling-video-v3-standard", name: "Kling 3.0 Lite", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-kling-video-v3-turbo", name: "Kling 3.0 Turbo", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-kling-video-o3-pro", name: "Kling O3 Pro", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-kling-video-o3-4k", name: "Kling O3 4K", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-kling-v3-motion-control", name: "Kling Motion Transfer", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-grok-video", name: "Grok Video", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-minimax-h3", name: "MiniMax H3", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-happy-horse-t2v", name: "Happy Horse", kind: "video", params: ["aspect_ratio", "duration"] },
    { id: "fal-topaz-upscale-video", name: "Topaz Upscale Video", kind: "video", params: ["aspect_ratio"] },

    // Audio / Voice / TTS / Music Models
    { id: "fal-elevenlabs-tts-v3", name: "ElevenLabs Voice TTS v3", kind: "tts", params: ["voice", "speed", "language"] },
    { id: "byteplus-tts-2", name: "BytePlus TTS 2.0", kind: "tts", params: ["voice", "speed"] },
    { id: "byteplus-voice-replication-2", name: "BytePlus Voice Replication 2.0", kind: "tts", params: ["voice"] },
    { id: "fal-seed-audio-1", name: "Seed Audio 1.0", kind: "tts", params: ["voice"] },
    { id: "fal-elevenlabs-music", name: "ElevenLabs Music", kind: "music", params: ["genre", "duration"] },
    { id: "fal-google-lyria-2", name: "Google Lyria 2 Music", kind: "music", params: ["duration"] },
    { id: "fal-minimax-music-v2-6", name: "MiniMax Music", kind: "music", params: ["duration"] },
    { id: "fal-elevenlabs-sound-effects-v2", name: "ElevenLabs Sound Effects", kind: "audio", params: ["duration"] },
  ],
};
