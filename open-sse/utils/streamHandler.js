// Stream handler with disconnect detection - shared for all providers
import { STREAM_STALL_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({ onDisconnect, onError, log, provider, model, reqTag = "" } = {}) {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout = null;

  // Only abnormal terminations are logged; normal completion is covered by "📊 done".
  // isError uses errorLine (always shown, ignores LOG_LEVEL) so failures survive quiet levels.
  const logStream = (symbol, status, isError = false) => {
    const duration = Date.now() - startTime;
    const emit = isError ? log?.errorLine : log?.line;
    if (emit) emit(reqTag, symbol, `${status} · ${provider}/${model} · ${duration}ms`);
    else console.log(`[${getTimeString()}] ${symbol} ${provider}/${model} · ${status} · ${duration}ms`);
  };

  return {
    signal: abortController.signal,
    startTime,
    provider,
    model,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream("⚡", `DISCONNECT: ${reason}`);
      dbg("CTRL", `${provider}/${model} | disconnect=${reason} | dur=${Date.now() - startTime}ms`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally (no line here — "📊 done" is authoritative)
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (error.name === "AbortError") {
        logStream("⚡", "ABORTED");
        return;
      }

      logStream("✗", `ERROR: ${error.message}${error.stack ? `\n    ${error.stack}` : ""}`, true);
      onError?.(error);
    },

    abort: () => abortController.abort()
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability.
 *
 * Stall detection lives in pipeWithDisconnect (tied to upstream byte
 * activity), not here — output of the transform stream may be silent
 * for long periods while raw bytes still flow (e.g. Kiro EventStream
 * binary frames buffering, Claude reasoning streams).
 */
export function createDisconnectAwareStream(transformStream, streamController, onAbortTerminal = null) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();
  let terminalEmitted = false;

  // Emit a synthesized terminal payload (e.g. Responses response.failed + [DONE]) once
  const emitTerminal = (controller) => {
    if (terminalEmitted || !onAbortTerminal) return;
    terminalEmitted = true;
    try {
      const bytes = onAbortTerminal();
      if (bytes) controller.enqueue(bytes);
    } catch { /* best-effort terminal */ }
  };

  return new ReadableStream({
    async pull(controller) {
      if (!streamController.isConnected()) {
        emitTerminal(controller);
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();

        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        const wasConnected = streamController.isConnected();
        const msg0 = error?.message || "";
        const isControllerClosed = msg0.includes("already closed") || msg0.includes("Invalid state");
        if (!isControllerClosed) streamController.handleError(error);
        reader.cancel().catch(() => {});
        writer.abort().catch(() => {});

        // Treat network resets / socket hang up / abort as graceful close
        const msg = error?.message || "";
        const code = error?.code || error?.cause?.code || "";
        const isNetworkClose =
          error.name === "AbortError" ||
          msg.includes("aborted") ||
          msg.includes("socket hang up") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("EPIPE") ||
          code === "ECONNRESET" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET";

        // Graceful close on network/abort, or when a structured terminal is available
        // (Responses passthrough prefers response.failed + [DONE] over a raw transport error)
        try {
          if (!wasConnected || isNetworkClose || onAbortTerminal) {
            emitTerminal(controller);
            controller.close();
          } else {
            controller.error(error);
          }
        } catch (e) { /* already closed or cancelled */ }
      }
    },

    cancel(reason) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    }
  });
}

/**
 * Pipe provider response through transform with disconnect detection.
 *
 * Stall watchdog tracks raw upstream byte activity, not transform output.
 * Reasoning models (Claude thinking via Kiro, etc.) can produce zero SSE
 * output for long stretches while partial EventStream frames keep arriving.
 * Measuring stall on the transform output caused false stalls and the
 * "failed to pipe response" error in Next.
 *
 * Any upstream chunk resets the timer. If no bytes arrive for
 * STREAM_STALL_TIMEOUT_MS (or custom timeoutMs), abort the underlying fetch via the controller.
 *
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 * @param {Function} onAbortTerminal - Optional callback for abort terminal bytes
 * @param {number} timeoutMs - Optional custom stall timeout (overrides STREAM_STALL_TIMEOUT_MS)
 */
export function pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal = null, timeoutMs = null) {
  // Use custom timeout if provided, otherwise fall back to global config
  const effectiveTimeout = timeoutMs || STREAM_STALL_TIMEOUT_MS;

  let stallTimer = null;
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = Date.now();
  const t0 = Date.now();
  const tag = "STREAM";
  const clearStall = () => {
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
  };
  const armStall = () => {
    clearStall();
    stallTimer = setTimeout(() => {
      stallTimer = null;

      // Calculate diagnostic stats
      const timeSinceStart = Date.now() - t0;
      const timeSinceLastChunk = Date.now() - lastChunkAt;
      const avgChunkSize = chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0;
      const avgChunksPerSecond = timeSinceStart > 0 ? (chunkCount / (timeSinceStart / 1000)).toFixed(2) : 0;

      // Enhanced stall timeout logging
      const p = streamController.provider?.toUpperCase() || "UNKNOWN";
      const m = streamController.model || "unknown";

      console.error(`[${getTimeString()}] ⏱️  [STALL] ${p} | ${m} | ${effectiveTimeout}ms timeout`);
      console.error(`         Chunks: ${chunkCount} | Total: ${totalBytes}B | Avg: ${avgChunkSize}B/chunk`);
      console.error(`         Rate: ${avgChunksPerSecond} chunks/sec | Last chunk: ${timeSinceLastChunk}ms ago`);
      console.error(`         Duration: ${timeSinceStart}ms | Diagnosis: ${chunkCount === 0 ? 'NO DATA RECEIVED - connection issue?' : 'Stream stalled - extended reasoning or server hang?'}`);

      dbg(tag, `STALL TIMEOUT ${effectiveTimeout}ms | chunks=${chunkCount} | bytes=${totalBytes} | sinceLast=${timeSinceLastChunk}ms`);
      streamController.handleError?.(new Error("stream stall timeout"));
      streamController.abort?.();
    }, effectiveTimeout);
  };

  // Wrap controller so every termination path clears the stall timer.
  // Without this, abort/cancel/downstream-error paths leave the timer armed
  // and a stale abort could fire after the request has already ended.
  const wrappedController = {
    signal: streamController.signal,
    startTime: streamController.startTime,
    isConnected: () => streamController.isConnected(),
    handleComplete: () => { dbg(tag, `complete | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleComplete(); },
    handleError: (e) => { dbg(tag, `error: ${e?.message} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleError(e); },
    handleDisconnect: (r) => { dbg(tag, `disconnect: ${r} | chunks=${chunkCount} | bytes=${totalBytes} | dur=${Date.now() - t0}ms`); clearStall(); streamController.handleDisconnect(r); },
    abort: () => { clearStall(); streamController.abort(); }
  };

  armStall();
  dbg(tag, `pipe start | stallTimeout=${STREAM_STALL_TIMEOUT_MS}ms`);

  const upstreamTap = new TransformStream({
    transform(chunk, controller) {
      const now = Date.now();
      const sz = chunk?.byteLength || chunk?.length || 0;
      const timeSinceStart = now - t0;
      const timeSinceLastChunk = now - lastChunkAt;

      chunkCount++;
      totalBytes += sz;
      lastChunkAt = now;

      // Log first chunk to see initial latency
      if (chunkCount === 1) {
        const p = streamController.provider?.toUpperCase() || "UNKNOWN";
        const m = streamController.model || "unknown";
        console.log(`[${getTimeString()}] ▶️  [STREAM] ${p} | ${m} | First chunk received after ${timeSinceStart}ms (${sz}B)`);
        dbg(tag, `FIRST CHUNK | latency=${timeSinceStart}ms | size=${sz}B`);
      }

      // Log significant gaps (>10 seconds) - indicates potential thinking/reasoning
      if (timeSinceLastChunk > 10000 && chunkCount > 1) {
        const p = streamController.provider?.toUpperCase() || "UNKNOWN";
        const m = streamController.model || "unknown";
        console.warn(`[${getTimeString()}] ⚠️  [STREAM] ${p} | ${m} | Large gap: ${timeSinceLastChunk}ms since last chunk (chunk #${chunkCount}, ${sz}B)`);
        dbg(tag, `LARGE GAP | ${timeSinceLastChunk}ms since chunk #${chunkCount-1} | now receiving chunk #${chunkCount} (${sz}B)`);
      }

      // Periodic progress updates every 50 chunks or every 30 seconds
      if (chunkCount % 50 === 0 || (timeSinceStart > 0 && timeSinceStart % 30000 < 500)) {
        const avgChunkSize = chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0;
        const chunksPerSec = timeSinceStart > 0 ? (chunkCount / (timeSinceStart / 1000)).toFixed(1) : "0.0";
        const bytesPerSec = timeSinceStart > 0 ? Math.round(totalBytes / (timeSinceStart / 1000)) : 0;
        const p = streamController.provider?.toUpperCase() || "UNKNOWN";
        const m = streamController.model || "unknown";
        console.log(`[${getTimeString()}] 📊 [STREAM] ${p} | ${m} | Progress: ${chunkCount} chunks, ${totalBytes}B total, ${chunksPerSec} chunks/sec, ${bytesPerSec}B/sec, ${avgChunkSize}B avg chunk`);
      }

      if (isDebugEnabled && (chunkCount <= 5 || chunkCount % 20 === 0 || timeSinceLastChunk > 5000)) {
        dbg(tag, `chunk #${chunkCount} | size=${sz}B | gap=${timeSinceLastChunk}ms | total=${totalBytes}B | rate=${timeSinceStart > 0 ? (chunkCount / (timeSinceStart / 1000)).toFixed(1) : "0.0"} chunks/sec`);
      }
      armStall();
      controller.enqueue(chunk);
    },
    flush() {
      const p = streamController.provider?.toUpperCase() || "UNKNOWN";
      const m = streamController.model || "unknown";
      const duration = Date.now() - t0;
      const avgChunkSize = chunkCount > 0 ? Math.round(totalBytes / chunkCount) : 0;
      const chunksPerSec = duration > 0 ? (chunkCount / (duration / 1000)).toFixed(1) : "0.0";
      const bytesPerSec = duration > 0 ? Math.round(totalBytes / (duration / 1000)) : 0;
      console.log(`[${getTimeString()}] ✅ [STREAM] ${p} | ${m} | Completed: ${chunkCount} chunks, ${totalBytes}B total in ${duration}ms (${chunksPerSec} chunks/sec, ${bytesPerSec}B/sec, ${avgChunkSize}B avg chunk)`);
      dbg(tag, `upstream EOF | chunks=${chunkCount} | bytes=${totalBytes} | dur=${duration}ms | avg=${avgChunkSize}B/chunk`);
      clearStall();
    }
  });

  const transformedBody = providerResponse.body
    .pipeThrough(upstreamTap)
    .pipeThrough(transformStream);

  return createDisconnectAwareStream(
    { readable: transformedBody, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
    wrappedController,
    onAbortTerminal
  );
}

