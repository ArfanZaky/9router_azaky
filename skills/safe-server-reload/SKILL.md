---
name: safe-server-reload
description: "Safe 9Router server reload and restart protocol. Prevents active chat sessions, parallel runs, and WebSocket connections from being killed when reloading 9Router under PM2."
---

# Safe Server Reload (9Router Host Self-Preservation)

> Protocol and runtime safeguards for reloading 9Router without severing active chat sessions or terminating concurrent agent runs.

## The Core Problem

When working on features or bug fixes inside the 9Router codebase (`custom/`), the coding agent itself runs as a child process under the 9Router host server (`chat-server.mjs`).

Executing a direct, synchronous process termination command such as `pm2 restart 0`, `npx pm2 restart 0`, or `taskkill` inside a tool call is **destructive**:
1. It immediately terminates the parent `chat-server.mjs` Node process.
2. It vaporizes the running AI agent loop mid-execution, interrupting tool calls before they return.
3. The response stream gets abruptly severed, displaying `(interrupted)` or a broken state in the UI.
4. It kills all other concurrent sessions running in 9Router.
5. In SQLite, the session and run state remain marked as interrupted or failed.

---

## The Solution: Two-Layer Defense

### Layer 1: Runtime Tool Interception (Server Guard)
In `src/lib/agent/tools.js`, the `bash` tool includes an automatic self-preservation guard. Whenever an agent or user executes any command matching:
- `pm2 restart 0` / `npx pm2 restart 0`
- `pm2 reload 0` / `npx pm2 reload 0`
- `npm run reload` / `npm run reload:safe`

The server intercepts the suicide command, launches `scripts/safe-reload.mjs` detached in the background, and returns immediately:
```json
{
  "ok": true,
  "scheduled": true,
  "safeReload": true,
  "message": "Direct host termination intercepted: PM2 reload scheduled safely via detached supervisor..."
}
```
This guarantees that the tool call resolves in 1ms, allowing the active turn to finish transmitting, the database to save, and the agent to provide its complete final answer.

### Layer 2: Detached Background Supervisor (`scripts/safe-reload.mjs`)
The supervisor runs completely independent of the 9Router Node process:
1. **Grace Period**: Waits 4 seconds (`--delay 4000`) so the active chat session finishes streaming its final tokens and checkpoints to the database.
2. **Session Polling**: Polls `GET /api/chat/runs` with the internal CLI token (`x-9r-cli-token`). If any session is actively running, it waits until all active sessions drop to 0 (`activeSessions.length === 0`).
3. **Graceful Reload**: Only when the server is completely idle does it trigger `pm2 restart 0`.
4. **Auto-Reconnection**: The browser UI (`ChatPageClient.js`) handles the brief 1-second server blip by falling back to HTTP polling and reconnecting WebSockets automatically. No messages or context are lost.

---

## Agent Usage Instructions

When modifying server code, environment variables, or running a Next.js production build:

### 1. Build First
```bash
npm run build
```

### 2. Trigger Safe Reload
```bash
node scripts/safe-reload.mjs
```
or simply:
```bash
npm run reload:safe
```
*(Even if you accidentally execute `npx pm2 restart 0`, Layer 1 runtime guard will automatically convert it into a safe reload).*

### 3. Deliver Final Answer
Immediately conclude your turn and output your final response to the user. Do not run further commands in the same turn. The detached supervisor will handle the restart seamlessly in the background.

---

## Command Reference

| Command | Purpose |
| :--- | :--- |
| `node scripts/safe-reload.mjs` | Standard detached reload (4s delay, polls until active sessions finish). |
| `node scripts/safe-reload.mjs --delay 6000` | Custom grace period before polling. |
| `node scripts/safe-reload.mjs --force --delay 2000` | Force reload after 2s without waiting for long background sessions. |
| `npm run reload:safe` | Shortcut script defined in `package.json`. |
