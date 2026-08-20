# freebuff2api — self-hosted gateway

Expose the **freebuff / codebuff free models** as an **OpenAI / Anthropic compatible API**, with rotating proxy pools, session & model management, and a live dashboard. Single Node process, minimal dependencies.

## Features

- **OpenAI-compatible** — `/v1/chat/completions` (streaming + non-streaming), `/v1/models`, `/v1/responses`
- **Anthropic-compatible** — `/v1/messages`, `/v1/messages/count_tokens`
- **Proxy rotation & pools** — HTTP / HTTPS (CONNECT) and SOCKS4a / SOCKS5 / SOCKS5h proxies, round-robin rotation, health tracking with exponential backoff, direct-connection fallback
- **Session management** — automatic session creation/reuse/caching, plus manual create/delete from the dashboard
- **Dynamic model registry** — pulls the official model list (refreshes every 6h, falls back to a built-in list)
- **Account pool** — multi-account rotation with per-account health, cooldown, and quota-aware selection
- **Caching** — session cache, run cache, model cache, behavior cache (all in-memory)
- **Streaming** — SSE passthrough with zero buffering, non-stream aggregation
- **Dashboard** — live overview, chat playground, models, sessions, proxies, accounts, settings

## Quick start

```bash
npm install
node server.js
```

Open `http://localhost:8787` for the dashboard. Base URL for clients: `http://localhost:8787/v1`.

## Configuration

Config is read from three sources, merged (later wins): `config.json` → `credentials/` dir / `proxies.txt` → environment variables. See `config.example.json` and `.env.example`.

| Source | Purpose |
|--------|---------|
| `FREEBUFF_TOKEN` | Freebuff account token(s), comma/newline separated, `token` or `token:uid` |
| `FREEBUFF_API_KEY` / `API_KEY` | API key for the OpenAI/Anthropic endpoints (default `freebuff-default-key`) |
| `PROXIES` | Outbound proxies, comma/newline separated |
| `FREEBUFF_DEBUG` | `true` to enable debug logs |
| `PORT` / `HOST` | Listen address (default `0.0.0.0:8787`) |

### Tokens

Put one token per line in `credentials/` (any file) or `FREEBUFF_TOKEN`, or use the dashboard **Settings** tab:

```
token1
token2:optional-uid
```

### Proxies

Put one proxy URL per line in `proxies.txt`, `PROXIES`, or the dashboard **Proxies** tab:

```
http://host:port
https://user:pass@host:port
socks5://host:port
socks5h://user:pass@host:port
socks4a://host:port
```

Proxies rotate round-robin; a proxy that fails is cooled off with exponential backoff (2s → 8s → 32s → 5m) and requests fall back to the next proxy or a direct connection.

## Management API

The dashboard uses these endpoints (most require the API key via `x-api-key` or `Authorization: Bearer`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/healthz`, `/api/status` | GET | Service + account/proxy/session health (no auth) |
| `/api/accounts` | GET | Account list with health state |
| `/api/models` | GET | Resolved model registry |
| `/api/sessions` | GET | Active cached sessions |
| `/api/session` | POST / DELETE | Force-create / delete a session `{ token, model }` |
| `/api/proxies` | GET | Proxy pool state |
| `/api/proxy` | POST / DELETE | Add / remove a proxy `{ url }` |
| `/api/proxy/test` | POST | Test one proxy `{ url }` → `{ ok, latencyMs }` |
| `/api/config` | GET / POST | Read / update tokens, proxies, debug, API key |

## Client integration

- **Base URL**: `http://host:8787/v1`
- **API Key**: `FREEBUFF_API_KEY` (default `freebuff-default-key`)

Works with any OpenAI SDK, Anthropic SDK, ChatGPT-Next-Web, LobeChat, one-api, etc.

## Project layout

```
server.js        HTTP server, config, proxy rotation, management API, static serving
engine.js        gateway engine (OpenAI/Anthropic routes, session/model lifecycle, streaming)
store.js         SQLite persistence (accounts, settings, quota cache) — data.db
register.js      native GSuite auto-register (Google OAuth → authToken) via Playwright
proxy.js         proxy pool + CONNECT/SOCKS tunneling connectors
quota.js         per-account quota scanner
public/          dashboard (index.html, style.css, app.js, icon.png)
scripts/         register CLI (`npm run register`)
config.example.json  example config
```

## Account automation

Two ways to add accounts, both landing tokens in the SQLite pool (`data.db`):

**1. Manual OAuth (upstream)** — *Accounts → + oauth login*: the server mints a
codebuff device code, you finish Google in your own browser, the token is polled
and stored. Routes: `POST /api/auth/cli/code`, `GET /api/auth/cli/status`.

**2. GSuite auto-register (native, `register.js`)** — *Accounts → Add accounts —
GSuite auto-register*: paste `email:password` per line and the whole Google OAuth
leg is automated with Playwright. Each account shows its own status dot and an
expandable log; accounts run one at a time (parallel Google logins from one IP get
flagged). Optional proxy per job or borrow from the proxy pool.

```bash
npm run register -- --email user@dom.com --password 'pw'
npm run register -- --batch accounts.txt --proxy socks5h://host:1080
xvfb-run -a npm run register -- --batch accounts.txt     # headless host
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/register` | start a job — `{email,password}` \| `{accounts:[…]}` \| `{batch:"email:pass\n…"}` + `proxy`, `useProxyPool`, `headless` |
| GET | `/api/register/status` | job counters + per-account status/log |
| POST | `/api/register/cancel` | stop after the current account |

Requires `npx playwright install chromium` (a system Google Chrome is preferred and
used automatically). **Headed by default** — headless Chrome hits Google's
"browser may not be secure" wall, so run the server under `xvfb-run -a` on a
headless host.

## Notes

- Freebuff enforces per-account daily session quotas (premium/standard/glm pools); rotation is best-effort across accounts.
- `engine.js` exposes an `internals` export that the management dashboard and management API consume.
