export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("id-ID");
}

export function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("id-ID", { hour12: false });
  } catch {
    return String(value);
  }
}

export function formatReset(unix) {
  if (!unix) return "—";
  return new Date(Number(unix) * 1000).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
