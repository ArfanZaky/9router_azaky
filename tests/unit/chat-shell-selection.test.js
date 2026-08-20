import { describe, expect, it } from "vitest";
import { executeTool } from "../../src/lib/agent/tools.js";

// Shell selection: agent can pick cmd/powershell/pwsh/bash/sh, or auto.
describe("agent shell selection", () => {
  it("runs a PowerShell command when shell=powershell", async () => {
    const res = await executeTool(
      "bash",
      { command: "Write-Output ps_test_42", shell: "powershell" },
      { workspace: process.cwd(), accessMode: "full" }
    );
    const parsed = JSON.parse(res);
    expect(parsed.ok).toBe(true);
    expect(parsed.stdout).toContain("ps_test_42");
  });

  it("runs a cmd command when shell=cmd", async () => {
    const res = await executeTool(
      "bash",
      { command: "echo cmd_test_7", shell: "cmd" },
      { workspace: process.cwd(), accessMode: "full" }
    );
    const parsed = JSON.parse(res);
    expect(parsed.ok).toBe(true);
    expect(parsed.stdout).toContain("cmd_test_7");
  });

  it("runs with auto shell (cmd on Windows, sh elsewhere)", async () => {
    const res = await executeTool(
      "bash",
      { command: "echo auto_ok" },
      { workspace: process.cwd(), accessMode: "full" }
    );
    const parsed = JSON.parse(res);
    expect(parsed.ok).toBe(true);
    expect(parsed.stdout).toContain("auto_ok");
  });
});
