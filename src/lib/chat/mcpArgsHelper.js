// Helper to normalize MCP stdio arguments across platforms and tool environments.

export function normalizeStdioArgs(command, args = []) {
  if (!Array.isArray(args)) return [];
  const list = [...args];

  // If running uvx with browser-use, ensure Python 3.12 on platforms where newer Python
  // (e.g. Python 3.14 on Windows) lacks pre-built binary wheels for cffi/zstandard/pydantic-core
  // and fails during build with MSVC PlatformError: Microsoft Visual C++ 14.0 or greater is required.
  const hasBrowserUse = list.some(
    (a) => typeof a === "string" && (a.includes("browser-use") || a.includes("mcp-browser-use"))
  );
  const hasPythonFlag = list.includes("--python") || list.includes("-p");

  if (hasBrowserUse && !hasPythonFlag) {
    if (command === "uvx") {
      return ["--python", "3.12", ...list];
    }
    if (command === "uv" && list[0] === "run") {
      return ["run", "--python", "3.12", ...list.slice(1)];
    }
  }

  return list;
}
