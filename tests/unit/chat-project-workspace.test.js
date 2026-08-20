import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectProjectWorkspace, resolveProjectWorkspace } from "../../src/lib/chat/projectWorkspace.js";

const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("chat project workspace", () => {
  it("returns files and package scripts while skipping dependency folders", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-project-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "src", "index.js"), "export default 1;\n");
    fs.writeFileSync(path.join(dir, "node_modules", "hidden.js"), "hidden\n");
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "sample", scripts: { test: "vitest" } }));

    const result = inspectProjectWorkspace(dir, 2);

    expect(result.workspacePath).toBe(fs.realpathSync(dir));
    expect(result.packageName).toBe("sample");
    expect(result.scripts).toEqual({ test: "vitest" });
    expect(result.files.map((file) => file.path)).toContain("src/index.js");
    expect(result.files.some((file) => file.path.includes("node_modules"))).toBe(false);
  });

  it("rejects files as workspaces", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-chat-project-"));
    dirs.push(dir);
    const file = path.join(dir, "file.txt");
    fs.writeFileSync(file, "x");
    expect(() => resolveProjectWorkspace(file)).toThrow("Workspace must be a directory");
  });
});
