// Migration 002: Ensure MCP browser-use stdio args include --python 3.12
// to avoid Windows setuptools MSVC build failures with newer/unsupported Pythons.

export default {
  version: 2,
  name: "mcp-browser-use-python",
  up(db) {
    try {
      const rows = db.all("SELECT id, command, args FROM chatMcpServers WHERE command IN ('uvx', 'uv')");
      for (const row of rows || []) {
        if (!row?.args) continue;
        let args;
        try {
          args = JSON.parse(row.args);
        } catch {
          continue;
        }
        if (!Array.isArray(args)) continue;
        const hasBrowserUse = args.some(
          (a) => typeof a === "string" && (a.includes("browser-use") || a.includes("mcp-browser-use"))
        );
        const hasPythonFlag = args.includes("--python") || args.includes("-p");
        if (hasBrowserUse && !hasPythonFlag) {
          const updated =
            row.command === "uv" && args[0] === "run"
              ? ["run", "--python", "3.12", ...args.slice(1)]
              : ["--python", "3.12", ...args];
          db.run("UPDATE chatMcpServers SET args = ? WHERE id = ?", [JSON.stringify(updated), row.id]);
        }
      }
    } catch {
      // Ignore if table does not exist yet
    }
  },
};
