export function isUpstreamConnectionError(err) {
  if (!err) return false;
  const msg = (typeof err === "string" ? err : (err?.message || String(err))).toLowerCase();
  return (
    msg.includes("upstream connection lost") ||
    msg.includes("stream stall timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("und_err_socket") ||
    msg.includes("premature close") ||
    msg.includes("other side closed") ||
    msg.includes("network error") ||
    msg.includes("connection reset") ||
    msg.includes("broken pipe") ||
    msg.includes("connection closed before message completed") ||
    msg.includes("terminated")
  );
}
