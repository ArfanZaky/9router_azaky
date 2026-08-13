# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-15
**Commit:** d887e7eb
**Branch:** master

## OVERVIEW

9Router WYx0 — local AI router/proxy that aggregates 50+ LLM providers behind an OpenAI-compatible API. Next.js 16 App Router + Express-style SSE streaming engine (`open-sse/`). Ships as global npm CLI (`wyxrouter`) with embedded dashboard, MITM proxy, and browser-based bulk account automation.

## STRUCTURE

```
9router/
├── open-sse/         # Core routing engine (executors, translator, RTK filters)
├── src/
│   ├── app/          # Next.js App Router (dashboard pages + API routes)
│   ├── lib/          # Services: oauth, tunnel, db, qoder, network
│   ├── shared/       # React components, constants, hooks, utils
│   ├── mitm/         # MITM proxy manager (cert gen, hosts, port 443)
│   └── store/        # Zustand stores
├── cli/              # Standalone CLI package (tray, menus, bundled app)
├── tests/            # Vitest suite (unit, translator, e2e, real)
├── scripts/          # Build helpers (start-standalone, discord-announce)
├── gitbook/          # Documentation site (multi-language)
├── i18n/             # Localization literals
├── public/           # Static assets + provider icons
└── skills/           # MCP skill packages (9router-chat, embeddings)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new AI provider | `open-sse/config/providerModels.js` + `providers.js` | Tests auto-cover via matrix |
| Add translator | `open-sse/translator/request/` or `response/` | Register in `translator/index.js` |
| Add executor | `open-sse/executors/` | One file per provider protocol |
| Dashboard page | `src/app/(dashboard)/dashboard/{name}/` | Next.js App Router conventions |
| Freebuff provider | `open-sse/providers/registry/freebuff.js` | Device flow + Google SSO (see `src/lib/oauth/services/freebuff.js`) |
| API route | `src/app/api/` | Next.js route handlers |
| OAuth/automation | `src/lib/oauth/services/` | Bulk import managers |
| Database schema | `src/lib/db/repos/` | SQLite via better-sqlite3 or sql.js |
| Token refresh | `open-sse/services/tokenRefresh.js` | Dedup cache prevents reuse attacks |
| MITM proxy | `src/mitm/manager.js` | Platform-specific elevated ops |
| CLI commands | `cli/src/cli/menus/` | Interactive menu system |
| Tests | `tests/unit/` or `tests/translator/` | See `tests/AGENTS.md` |
| RTK filters | `open-sse/rtk/filters/` | Output compression for agents |

## CONVENTIONS

- **JS only** — no TypeScript. Uses `jsconfig.json` path aliases (`@/` → `src/`, `open-sse` → `open-sse/`)
- **ESM imports** throughout (`import`/`export`), but translator uses `require()` internally (bundler-only)
- **Standalone output** — `next.config.mjs` sets `output: "standalone"` for CLI bundling
- **Path aliases in tests** — Vitest config at `tests/vitest.config.js` resolves `@/` and `open-sse`
- **Singleton pattern** — bulk import managers use `globalThis.__*Singleton` getters
- **Provider short aliases** — 2-letter codes (`cc`=anthropic, `gh`=github, `cb`=codebuddy) in `PROVIDER_ID_TO_ALIAS`
- **Self-healing runtime** — native deps (`better-sqlite3`, `systray2`) installed to `~/.9router/runtime/` at postinstall, not in `node_modules`

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER rewrite entire files** — use surgical edits (apply_diff style)
- **NEVER pass string content to CommandCode** — must be array of content blocks
- **NEVER filter out tool messages** — always retain tool + assistant tool_call messages
- **NEVER route inline completion to external models** — latency-critical, use `MODEL_NO_MAP`
- **NEVER deduplicate access tokens automatically** — users manage duplicates
- **NEVER call `buildCursorRequest` twice** — double-translation drops `tool_results`
- **NEVER send Authorization header for Anthropic-Compatible** if `apiKey` present
- **ALWAYS send `message_start` first** for Claude streaming responses
- **ALWAYS use `--config tests/vitest.config.js`** when running tests (alias resolution)
- **ALWAYS import `registerAll.js`** in translator tests (prevents false passes from empty registry)

## UNIQUE STYLES

- **`it.fails()` bug tracking** — confirmed bugs wrapped in `it.fails`; turns red when fixed → reminder to promote to `it()`
- **Data-driven matrix tests** — `tests/translator/matrix.js` reads `PROVIDER_MODELS` directly; new providers auto-covered
- **OpenAI as intermediate format** — all translations go `source → openai → target` (lossy for thinking/images/audio)
- **RTK (Runtime Token Kompression)** — filters compress agent output (git diff, grep, ls) before forwarding
- **Dedup refresh cache** — `refreshDedupCache` with 10s TTL prevents token reuse attacks on concurrent requests
- **Runtime file copy** — MITM server.js copied to DATA_DIR to avoid EBUSY during npm updates

## COMMANDS

```bash
# Development
npm run dev                    # Next.js dev on :20128
npm run build                  # Production build (standalone)
npm run start                  # Start via scripts/start-standalone.mjs

# Testing (from project root)
cd tests && npx vitest run --config ./vitest.config.js
cd tests && npx vitest run --config ./vitest.config.js "tests/translator/"
RUN_REAL=1 npx vitest run --config ./vitest.config.js "tests/translator/real/"
RUN_E2E=1 npx vitest run --config ./vitest.config.js

# CLI packaging (from cli/)
cd cli && npm run build        # Bundle standalone app
cd cli && npm run pack:cli     # Create .tgz
cd cli && npm run publish:cli  # Publish to npm
```

## NOTES

- **Port 20128** is the default dev/prod port
- **`/v1/*` rewrites** to `/api/v1/*` via next.config.mjs (also `/codex/*` → `/api/v1/responses`)
- **Two SQLite strategies** — `better-sqlite3` (native, fast) with `sql.js` (WASM) fallback
- **Proxy body size** — configurable via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` env (default 128mb)
- **Vitest concurrency** — `maxConcurrency: 60` for parallel provider smoke tests
- **Docker** — multi-stage build, `su-exec` privilege drop, volume permission patching in entrypoint
- **Deprecated providers** — Qwen discontinued 2026-04-15; Antigravity carries ban risk
- **`NODE_EXTRA_CA_CERTS`** — MITM sets this system-wide for other dev tools to trust 9Router CA
