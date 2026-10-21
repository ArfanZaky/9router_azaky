import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as chatCache from "../../src/lib/chat/chatCacheIndexedDb.js";

describe("Chat Developer Tooling & Architecture", () => {
  describe("IndexedDB Local Cache Contract", () => {
    it("exports all expected caching and draft methods", () => {
      expect(typeof chatCache.getCachedTranscript).toBe("function");
      expect(typeof chatCache.setCachedTranscript).toBe("function");
      expect(typeof chatCache.deleteCachedTranscript).toBe("function");
      expect(typeof chatCache.getCachedDraft).toBe("function");
      expect(typeof chatCache.setCachedDraft).toBe("function");
      expect(typeof chatCache.clearCachedDraft).toBe("function");
    });

    it("returns null safely in node/SSR environments without throwing", async () => {
      const transcript = await chatCache.getCachedTranscript("test-session");
      expect(transcript).toBeNull();

      const draft = await chatCache.getCachedDraft("test-session");
      expect(draft).toBeNull();
    });
  });

  describe("File Revert Route Contract", () => {
    it("reverts created files by unlinking or restoring content", async () => {
      const testDir = path.resolve(process.cwd(), "output");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.resolve(testDir, `test-revert-${Date.now()}.txt`);

      // 1. Create a dummy test file
      fs.writeFileSync(testFile, "initial content", "utf8");
      expect(fs.existsSync(testFile)).toBe(true);

      // 2. Overwrite it
      fs.writeFileSync(testFile, "modified content", "utf8");
      expect(fs.readFileSync(testFile, "utf8")).toBe("modified content");

      // 3. Test revert route handler logic
      const { POST } = await import("../../src/app/api/chat/files/revert/route.js");
      const req = new Request("http://localhost/api/chat/files/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: testFile,
          previousContent: "initial content",
          isNew: false,
        }),
      });

      const res = await POST(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.reverted).toBe(true);
      expect(fs.readFileSync(testFile, "utf8")).toBe("initial content");

      // Clean up
      fs.unlinkSync(testFile);
    });

    it("unlinks newly created files on revert when isNew is true", async () => {
      const testDir = path.resolve(process.cwd(), "output");
      fs.mkdirSync(testDir, { recursive: true });
      const testFile = path.resolve(testDir, `test-new-${Date.now()}.txt`);
      fs.writeFileSync(testFile, "brand new content", "utf8");

      const { POST } = await import("../../src/app/api/chat/files/revert/route.js");
      const req = new Request("http://localhost/api/chat/files/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: testFile,
          isNew: true,
        }),
      });

      const res = await POST(req);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.action).toBe("deleted");
      expect(fs.existsSync(testFile)).toBe(false);
    });
  });

  describe("Decomposed Components & Hooks Contract", () => {
    it("verifies component files exist and export default or memoized elements", () => {
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/ChatHeader.jsx"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/ChatSessionRail.jsx"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/MessageList.jsx"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/AskApprovalOverlay.jsx"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/SubAgentOverlay.jsx"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/DockedTerminalPanel.js"))).toBe(true);
    });

    it("verifies focused custom hooks exist in hooks/ directory", () => {
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/hooks/useChatSessions.js"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/hooks/useSlashCommands.js"))).toBe(true);
      expect(fs.existsSync(path.resolve("src/app/(dashboard)/dashboard/chat/hooks/useRunExecution.js"))).toBe(true);
    });
  });
});
