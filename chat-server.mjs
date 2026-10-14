import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import next from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const hasBuild =
  fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID")) &&
  fs.existsSync(path.join(projectRoot, ".next", "prerender-manifest.json"));
if (!process.env.NODE_ENV && hasBuild) process.env.NODE_ENV = "production";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 2026);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".lua": "text/plain; charset=utf-8",
};

function serveWorkspaceFile(request, response, relativePath) {
  try {
    const raw = decodeURIComponent(String(relativePath || "")).replace(/^\/+/, "");
    const safeTarget = path.resolve(projectRoot, raw);
    const rel = path.relative(projectRoot, safeTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      response.writeHead(403, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Access denied" }));
      return;
    }
    if (!fs.existsSync(safeTarget) || !fs.statSync(safeTarget).isFile()) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    const ext = path.extname(safeTarget).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const stat = fs.statSync(safeTarget);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(safeTarget).pipe(response);
  } catch (err) {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: err?.message || "Internal error" }));
  }
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/** Bridge for Next route modules (path aliases) without raw-importing src/. */
const socketsByRun = new Map();
globalThis.__chatWsHub = {
  broadcast(runId, event) {
    const set = socketsByRun.get(runId);
    if (!set) return;
    for (const socket of set) send(socket, { type: "event", event });
  },
};

await app.prepare();
const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/output/")) {
    return serveWorkspaceFile(request, response, url.pathname.slice(1));
  }
  if (url.pathname === "/api/chat/files") {
    const requestedPath = url.searchParams.get("path") || "";
    if (requestedPath) {
      return serveWorkspaceFile(request, response, requestedPath);
    }
  }
  if (url.pathname.startsWith("/_next/static/css/")) {
    const cssFile = path.basename(url.pathname);
    const cssTarget = path.resolve(projectRoot, ".next", "static", "css", cssFile);
    if (!fs.existsSync(cssTarget)) {
      try {
        const cssDir = path.resolve(projectRoot, ".next", "static", "css");
        if (fs.existsSync(cssDir)) {
          const files = fs.readdirSync(cssDir).filter(f => f.endsWith(".css"));
          if (files.length > 0) {
            files.sort((a, b) => {
              const sa = fs.statSync(path.join(cssDir, a));
              const sb = fs.statSync(path.join(cssDir, b));
              return sb.size - sa.size;
            });
            const fallbackFile = path.join(cssDir, files[0]);
            const stat = fs.statSync(fallbackFile);
            response.writeHead(200, {
              "Content-Type": "text/css; charset=UTF-8",
              "Content-Length": stat.size,
              "Cache-Control": "no-cache, must-revalidate",
              "X-Asset-Fallback": "true",
            });
            fs.createReadStream(fallbackFile).pipe(response);
            return;
          }
        }
      } catch {}
    }
  }
  return handle(request, response);
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname !== "/api/chat/ws") {
    // Leave Next.js HMR / other upgrades alone.
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (socket) => {
  let runId = null;
  const detach = () => {
    if (!runId) return;
    const set = socketsByRun.get(runId);
    set?.delete(socket);
    if (set && set.size === 0) socketsByRun.delete(runId);
    runId = null;
  };
  socket.on("close", detach);
  socket.on("error", detach);
  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid JSON" });
      return;
    }
    if (message.type !== "subscribe" || !message.runId) {
      send(socket, { type: "error", message: "Expected { type: 'subscribe', runId, after? }" });
      return;
    }
    try {
      detach();
      runId = message.runId;
      if (!socketsByRun.has(runId)) socketsByRun.set(runId, new Set());
      socketsByRun.get(runId).add(socket);

      // Replay via Next API so path aliases stay inside the Next runtime.
      const after = Number(message.after || 0);
      const snapshotRes = await fetch(
        `http://127.0.0.1:${port}/api/chat/runs/${encodeURIComponent(runId)}?after=${after}`
      );
      const snapshot = await snapshotRes.json().catch(() => null);
      if (!snapshotRes.ok || !snapshot) {
        send(socket, { type: "error", message: snapshot?.error || "Run not found", runId });
        return;
      }
      send(socket, { type: "snapshot", run: snapshot });
      send(socket, { type: "ready", runId });
    } catch (error) {
      send(socket, { type: "error", message: error?.message || "Subscription failed" });
    }
  });
  send(socket, { type: "hello" });
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port}${dev ? " (dev)" : ""}`);
});
