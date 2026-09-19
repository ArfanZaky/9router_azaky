# 9Router Skills

Skills for AI agents running with 9Router. Each skill folder contains a `SKILL.md` with instructions, endpoint specs, and examples.

## Available Skills

| Skill | Description | Doc |
|---|---|---|
| [`9router`](9router/) | Entry point — setup, auth, model discovery, index of all capabilities | [SKILL.md](9router/SKILL.md) |
| [`9router-chat`](9router-chat/) | Chat & code generation via `/v1/chat/completions` or `/v1/messages` | [SKILL.md](9router-chat/SKILL.md) |
| [`9router-image`](9router-image/) | Image generation via `/v1/images/generations` | [SKILL.md](9router-image/SKILL.md) |
| [`9router-tts`](9router-tts/) | Text-to-speech via `/v1/audio/speech` | [SKILL.md](9router-tts/SKILL.md) |
| [`9router-stt`](9router-stt/) | Speech-to-text via `/v1/audio/transcriptions` | [SKILL.md](9router-stt/SKILL.md) |
| [`9router-embeddings`](9router-embeddings/) | Vector embeddings via `/v1/embeddings` | [SKILL.md](9router-embeddings/SKILL.md) |
| [`9router-video`](9router-video/) | Video generation via `/v1/videos/generations` (xAI Grok Imagine) | [SKILL.md](9router-video/SKILL.md) |
| [`9router-web-search`](9router-web-search/) | Web & X search via `/v1/search` | [SKILL.md](9router-web-search/SKILL.md) |
| [`browser-use`](browser-use/) | Browser interaction, automation & scraping via `browser-harness` | [SKILL.md](browser-use/SKILL.md) |

## Quick Start for Agents

Add to your system prompt:

```text
You have access to 9Router AI gateway. To use a capability:
1. Check available models: curl $NINEROUTER_URL/v1/models (or /v1/models/<kind>)
2. Read the relevant skill file: skills/<skill-name>/SKILL.md
3. Call the endpoint with Authorization: Bearer $NINEROUTER_KEY
```

Or read the entry-point skill directly:

```bash
cat skills/9router/SKILL.md
```

## Raw URLs (for remote agents / curl)

When an agent needs to fetch skills remotely without cloning the repo:

| Skill | Raw URL |
|---|---|
| Entry point | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md |
| Chat | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-chat/SKILL.md |
| Image | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-image/SKILL.md |
| TTS | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-tts/SKILL.md |
| STT | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-embeddings/SKILL.md |
| Video | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-video/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-search/SKILL.md |
| Browser Use | https://raw.githubusercontent.com/browser-use/browser-harness/main/install.md |
