import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

describe("chat session copy and duplicate semantics", () => {
  it("registers /copy and /duplicate slash commands with clean summaries without em dashes", () => {
    const palettePath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/SlashCommandPalette.js");
    const content = fs.readFileSync(palettePath, "utf8");
    expect(content).toContain('{ name: "copy", summary: "Create new session with same name and path" }');
    expect(content).toContain('{ name: "duplicate", summary: "Duplicate active session with same name and path" }');
    expect(content).not.toContain("\u2014"); // Anti-Slop R-02
  });

  it("builds exact duplicate payload preserving title, path, and model while clearing queues", () => {
    const sourceSession = {
      id: "sess_orig_123",
      title: "Antares Feature Refactor",
      workspacePath: "F:\\project\\antares",
      codebase: "F:\\project\\antares",
      model: "cb/deepseek-v4.1-flash",
      providerId: "codebuddy",
      systemPrompt: "You are an architect.",
      params: { temperature: 0.5, max_tokens: 8192 },
      projectMeta: {
        agentRole: "reviewer",
        queuedMessages: [{ id: "q1", text: "Old queued item" }],
      },
    };

    const sessionName = sourceSession.title || "New chat";
    const workspacePath = sourceSession.workspacePath || sourceSession.codebase || "";
    const codebase = sourceSession.codebase || sourceSession.workspacePath || "";
    const { queuedMessages, ...cleanProjectMeta } = sourceSession.projectMeta || {};

    const payload = {
      title: sessionName,
      model: sourceSession.model || "",
      providerId: sourceSession.providerId || "",
      systemPrompt: sourceSession.systemPrompt || "",
      params: sourceSession.params,
      codebase,
      workspacePath,
      projectMeta: cleanProjectMeta,
    };

    expect(payload.title).toBe(sourceSession.title);
    expect(payload.workspacePath).toBe(sourceSession.workspacePath);
    expect(payload.codebase).toBe(sourceSession.codebase);
    expect(payload.model).toBe(sourceSession.model);
    expect(payload.projectMeta.agentRole).toBe("reviewer");
    expect(payload.projectMeta.queuedMessages).toBeUndefined();
  });

  it("ChatPageClient includes onCopy handler, header Duplicate button, modal Duplicate button, and /duplicate command", () => {
    const clientPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ChatPageClient.js");
    const content = fs.readFileSync(clientPath, "utf8");

    // SessionRailItem prop & button
    expect(content).toContain("onCopy,");
    expect(content).toContain('title="Duplicate session (new session with same name and path)"');
    expect(content).toContain("content_copy");

    // Header Duplicate button
    expect(content).toMatch(/>\s*Duplicate\s*<\/Button>/);

    // Modal Duplicate button
    expect(content).toContain('sessionModalMode === "edit"');

    // Copy handler and /copy or /duplicate command
    expect(content).toContain("const handleCopySession = useCallback");
    expect(content).toContain('name === "copy" || name === "duplicate"');
    expect(content).toContain("onCopy={handleCopySession}");

    // Anti-slop R-02 check in new strings
    expect(content).not.toContain("Duplicate session \u2014");
    expect(content).not.toContain("Copy session \u2014");
  });
});
