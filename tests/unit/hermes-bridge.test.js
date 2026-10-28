import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  extractMessageText,
  buildHermesPrompt,
  isHermesAvailable,
  hermesBinCandidates,
} from "../../src/lib/agent/hermesBridge.js";

describe("hermesBridge", () => {
  describe("extractMessageText", () => {
    it("handles string content", () => {
      expect(extractMessageText({ content: "hello world" })).toBe("hello world");
    });

    it("handles array content parts", () => {
      const msg = {
        content: [
          { type: "text", text: "part 1" },
          { type: "text", text: "part 2" },
        ],
      };
      expect(extractMessageText(msg)).toBe("part 1\npart 2");
    });

    it("handles object content", () => {
      expect(extractMessageText({ content: { text: "from obj" } })).toBe("from obj");
      expect(extractMessageText({ content: { message: "msg field" } })).toBe("msg field");
    });

    it("handles null or missing content", () => {
      expect(extractMessageText(null)).toBe("");
      expect(extractMessageText({})).toBe("");
    });
  });

  describe("buildHermesPrompt", () => {
    it("returns plain query when there are no prior messages", () => {
      const messages = [{ role: "user", content: "Initial prompt" }];
      const result = buildHermesPrompt({ messages });

      expect(result.queryText).toBe("Initial prompt");
      expect(result.promptText).toBe("Initial prompt");
      expect(result.imageAttachment).toBeNull();
      expect(result.promptText).not.toContain("Previous Conversation Context");
    });

    it("includes prior conversation history when switching role to hermes", () => {
      const messages = [
        { role: "user", content: "Buat fitur kalkulator BMI di utils.js" },
        { role: "assistant", content: "Baik, sudah saya buat fungsi calculateBMI()." },
        { role: "user", content: "Sekarang tambahkan unit testnya" },
      ];

      const result = buildHermesPrompt({ messages });

      expect(result.queryText).toBe("Sekarang tambahkan unit testnya");
      expect(result.promptText).toContain("[Previous Conversation Context]");
      expect(result.promptText).toContain("[User]\nBuat fitur kalkulator BMI di utils.js");
      expect(result.promptText).toContain("[Assistant]\nBaik, sudah saya buat fungsi calculateBMI().");
      expect(result.promptText).toContain("[End of Previous Context]");
      expect(result.promptText).toContain("Sekarang tambahkan unit testnya");
    });

    it("includes tool summaries when tools were called in prior turns", () => {
      const messages = [
        { role: "user", content: "Periksa package.json" },
        { role: "tool", name: "read_file", content: '{"name": "9router"}' },
        { role: "assistant", content: "Package bernama 9router" },
        { role: "user", content: "Update versinya" },
      ];

      const result = buildHermesPrompt({ messages });

      expect(result.promptText).toContain("[Tool (read_file)]");
      expect(result.promptText).toContain('{"name": "9router"}');
      expect(result.promptText).toContain("Update versinya");
    });

    it("truncates very long prior history while keeping recent turns", () => {
      const messages = [];
      for (let i = 0; i < 40; i++) {
        messages.push({ role: "user", content: `Question ${i}` });
        messages.push({ role: "assistant", content: `Answer ${i}` });
      }
      messages.push({ role: "user", content: "Latest question" });

      const result = buildHermesPrompt({ messages, maxTurns: 10 });

      expect(result.queryText).toBe("Latest question");
      expect(result.promptText).toContain("Question 39");
      expect(result.promptText).toContain("Answer 39");
      expect(result.promptText).not.toContain("Question 5");
    });

    it("includes custom system prompt if provided", () => {
      const messages = [
        { role: "user", content: "Prior" },
        { role: "assistant", content: "Prior ans" },
        { role: "user", content: "Current" },
      ];

      const result = buildHermesPrompt({
        messages,
        systemPrompt: "Always write code in TypeScript.",
      });

      expect(result.promptText).toContain("[System Instructions / Constraints]");
      expect(result.promptText).toContain("Always write code in TypeScript.");
      expect(result.promptText).toContain("[Previous Conversation Context]");
      expect(result.promptText).toContain("Current");
    });

    it("detects image attachment in the latest user message", () => {
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this screenshot" },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" } },
          ],
        },
      ];

      const result = buildHermesPrompt({ messages });

      expect(result.queryText).toBe("Look at this screenshot");
      expect(result.imageAttachment).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    });
  });

  describe("isHermesAvailable", () => {
    it("checks availability without throwing", async () => {
      const status = await isHermesAvailable();
      expect(status).toHaveProperty("available");
      expect(status).toHaveProperty("path");
      expect(typeof status.available).toBe("boolean");
    });
  });

  describe("hermesBinCandidates", () => {
    it("prefers HERMES_BIN and resolves from PATH / home, not hardcoded Windows paths", () => {
      const prev = process.env.HERMES_BIN;
      process.env.HERMES_BIN = "/opt/custom/hermes";
      const list = hermesBinCandidates();
      if (prev === undefined) delete process.env.HERMES_BIN;
      else process.env.HERMES_BIN = prev;

      expect(list[0]).toBe("/opt/custom/hermes");
      expect(list).toContain(path.join(os.homedir(), ".local", "bin", "hermes"));
      if (process.platform !== "win32") {
        expect(list.some((p) => /^[A-Za-z]:[\\/]/.test(p))).toBe(false);
      }
    });
  });
});
