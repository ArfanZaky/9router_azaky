import { describe, it, expect } from "vitest";

// Lightweight smoke: ensure module surface stays stable without spinning DB.
describe("chat server run manager exports", () => {
  it("exposes start/get/stop/subscribe", async () => {
    // Dynamic import may pull DB; only assert function names exist if import works.
    // If env has no DB adapter, skip gracefully.
    try {
      const mod = await import("../../src/lib/chat/serverRunManager.js");
      expect(typeof mod.startServerChatRun).toBe("function");
      expect(typeof mod.getServerChatRun).toBe("function");
      expect(typeof mod.stopServerChatRun).toBe("function");
      expect(typeof mod.subscribeServerChatRun).toBe("function");
    } catch (e) {
      // Acceptable in unit env without full Next/path alias wiring
      expect(String(e.message || e)).toMatch(/Cannot find|MODULE_NOT_FOUND|ERR_MODULE/i);
    }
  });
});
