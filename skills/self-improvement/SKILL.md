---
name: self-improvement
description: Hermes-style dual-tier memory and procedural skill self-evolution. Learn project gotchas, save user preferences, and create or patch skills automatically.
---

# Self-Improving AI (Hermes Architecture)

This skill enables the 9Router agent to continuously learn and retain knowledge across conversation turns and sessions without context window degradation.

## 1. Dual-Tier Memory Structure

Memory is persistent, bounded, and injected into the agent system prompt prefix:

1. **`MEMORY.md` (Project Knowledge & Gotchas)**:
   - Stored in `<workspace>/.9router/MEMORY.md`.
   - Max ~2,400 characters (~600 tokens).
   - Holds durable project facts: framework quirks, specific build scripts, active service ports, database configurations, and error causes that were solved.
   - Bounded with automated oldest-entry FIFO eviction so prompt overhead remains strictly predictable.

2. **`USER.md` (User Preferences & Style)**:
   - Stored in `<workspace>/.9router/USER.md` or global fallback `DATA_DIR/memory/USER.md`.
   - Max ~1,400 characters (~350 tokens).
   - Holds user communication style, preferred languages, concise tone instructions, and negative rules (e.g. "never do X").

## 2. Tools

- **`manage_memory`**:
  - `action`: `view` | `append` | `replace`
  - `target`: `project` | `user`
  - `content`: bullet point string or full text
  - Example: `manage_memory({ action: "append", target: "project", content: "- Next.js build requires node 22 and runs on port 2026." })`

- **`manage_skill`**:
  - `action`: `list` | `view` | `create` | `patch`
  - `name`: kebab-case skill identifier (e.g. `nextjs-optimization`)
  - `description`: 1-line summary for frontmatter and catalogue
  - `content`: Markdown body with workflow instructions
  - Read-before-write discipline: always inspect or view the existing skill before patching.

## 3. Post-Turn Background Review Loop

At the conclusion of each agent turn:
1. A detached background reviewer evaluates the turn using the local model endpoint.
2. If new durable project facts or explicit user preferences are identified, they are automatically deduplicated and committed into `MEMORY.md` and `USER.md`.
3. Subsequent turns and sessions automatically receive these updated memories in their initial system prompt without requiring manual user repetition.
