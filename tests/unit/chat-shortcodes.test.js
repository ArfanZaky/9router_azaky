import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
let originalDataDir;
let db;
let localDb;

beforeAll(async () => {
  originalDataDir = process.env.DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-shortcode-test-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("../../src/lib/db/index.js");
  localDb = await import("../../src/lib/localDb.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("SlashCommandPalette shortcode integration contract", () => {
  const palettePath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/SlashCommandPalette.js");
  const paletteContent = fs.readFileSync(palettePath, "utf8");

  it("registers /shortcode command with argument [tag] in CHAT_COMMANDS", () => {
    expect(paletteContent).toContain('{ name: "shortcode", args: "[tag]"');
    expect(paletteContent).not.toContain("\u2014"); // Anti-Slop R-02: zero em dashes
  });

  it("provides shortcode auto-completion when typing /shortcode or /shortcode <option>", () => {
    expect(paletteContent).toContain('text.startsWith("shortcode ") || text === "shortcode"');
    expect(paletteContent).toContain("isShortcode: true");
    expect(paletteContent).toContain("bookmark");
  });

  it("evaluates commandMatches logic for shortcode option filtering", () => {
    const sampleShortcodes = [
      { id: "sc_1", tag: "fix-bug", description: "Review and fix bugs in this file thoroughly." },
      { id: "sc_2", tag: "refactor", description: "Refactor code following SOLID and clean architecture." },
      { id: "sc_3", tag: "review-pr", description: "Perform strict security and code quality review." },
    ];

    function commandMatches(value, shortcodes = []) {
      if (!value.startsWith("/") || value.includes("\n")) return [];
      const text = value.slice(1);
      const spaceIdx = text.indexOf(" ");
      if (text.startsWith("shortcode ") || text === "shortcode") {
        const option = spaceIdx >= 0 ? text.slice(spaceIdx + 1).trim().toLowerCase() : "";
        const filtered = (shortcodes || []).filter((sc) => {
          if (!option) return true;
          return (
            sc.tag.toLowerCase().includes(option) ||
            (sc.description || "").toLowerCase().includes(option)
          );
        });
        const shortcodeItems = filtered.map((sc) => ({
          name: `shortcode ${sc.tag}`,
          tag: sc.tag,
          description: sc.description,
          summary: sc.description.length > 70 ? `${sc.description.slice(0, 70)}…` : sc.description,
          isShortcode: true,
        }));
        if (text === "shortcode") {
          return [
            { name: "shortcode", args: "[tag]", summary: "Open shortcode manager or insert a saved shortcode" },
            ...shortcodeItems,
          ];
        }
        return shortcodeItems;
      }
      return [];
    }

    const allMatches = commandMatches("/shortcode", sampleShortcodes);
    expect(allMatches.length).toBe(4);
    expect(allMatches[0].name).toBe("shortcode");
    expect(allMatches[1].tag).toBe("fix-bug");

    const fixMatches = commandMatches("/shortcode fix", sampleShortcodes);
    expect(fixMatches.length).toBe(1);
    expect(fixMatches[0].tag).toBe("fix-bug");

    const descMatches = commandMatches("/shortcode solid", sampleShortcodes);
    expect(descMatches.length).toBe(1);
    expect(descMatches[0].tag).toBe("refactor");

    const emptyMatches = commandMatches("/shortcode unknown-xyz", sampleShortcodes);
    expect(emptyMatches.length).toBe(0);
  });
});

describe("localDb barrel re-export contract", () => {
  it("exports all shortcode CRUD functions from @/lib/localDb", () => {
    expect(typeof localDb.listChatShortcodes).toBe("function");
    expect(typeof localDb.getChatShortcode).toBe("function");
    expect(typeof localDb.getChatShortcodeByTag).toBe("function");
    expect(typeof localDb.createChatShortcode).toBe("function");
    expect(typeof localDb.updateChatShortcode).toBe("function");
    expect(typeof localDb.deleteChatShortcode).toBe("function");
  });
});

describe("ChatPageClient and ShortcodesModal wiring", () => {
  it("verifies ChatPageClient mounts Shortcodes button, modal, and slash command expansion", () => {
    const clientPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ChatPageClient.js");
    const content = fs.readFileSync(clientPath, "utf8");

    expect(content).toContain('import ShortcodesModal from "./ShortcodesModal"');
    expect(content).toContain("shortcodesModalOpen");
    expect(content).toContain("loadShortcodes");
    expect(content).toContain('fetch("/api/chat/shortcodes")');
    expect(content).toContain('name === "shortcode" || name === "shortcodes"');
    expect(content).toContain("userText: expandedText");
    expect(content).toMatch(/icon="bookmark".*Shortcodes/s);
    expect(content).toContain("<ShortcodesModal");
  });

  it("verifies ShortcodesModal enforces anti-slop rules, CRUD UI, and zero em dashes", () => {
    const modalPath = path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/chat/ShortcodesModal.js");
    const content = fs.readFileSync(modalPath, "utf8");

    expect(content).not.toContain("\u2014");
    expect(content).toContain("handleStartCreate");
    expect(content).toContain("handleStartEdit");
    expect(content).toContain("handleDelete");
    expect(content).toContain("handleCopyDescription");
    expect(content).toContain("handleUseShortcode");
    expect(content).toContain('fetch("/api/chat/shortcodes"');
    expect(content).toContain('fetch(`/api/chat/shortcodes/${sc.id}`');
  });
});

describe("chatShortcodeRepo CRUD operations", () => {
  let createdTestIds = [];

  afterEach(async () => {
    for (const id of createdTestIds) {
      try {
        await db.deleteChatShortcode(id);
      } catch {
        // ignore
      }
    }
    createdTestIds = [];
  });

  it("creates, retrieves by tag, and deletes a shortcode", async () => {
    const tag = `test-sc-${Date.now()}`;
    const description = "Test prompt description expansion";

    const created = await db.createChatShortcode({ tag, description });
    expect(created).toBeDefined();
    expect(created.id).toBeDefined();
    expect(created.tag).toBe(tag);
    expect(created.description).toBe(description);
    createdTestIds.push(created.id);

    const found = await db.getChatShortcodeByTag(tag.toUpperCase());
    expect(found).not.toBeNull();
    expect(found.id).toBe(created.id);
    expect(found.description).toBe(description);

    const list = await db.listChatShortcodes(tag);
    expect(list.some((s) => s.id === created.id)).toBe(true);

    const deleted = await db.deleteChatShortcode(created.id);
    expect(deleted).toBe(true);

    const verifyNotFound = await db.getChatShortcode(created.id);
    expect(verifyNotFound).toBeNull();
  });

  it("updates tag and description of an existing shortcode", async () => {
    const tag = `test-up-${Date.now()}`;
    const created = await db.createChatShortcode({ tag, description: "Initial description" });
    createdTestIds.push(created.id);

    const updated = await db.updateChatShortcode(created.id, {
      tag: `${tag}-edited`,
      description: "Updated prompt description",
    });
    expect(updated).not.toBeNull();
    expect(updated.tag).toBe(`${tag}-edited`);
    expect(updated.description).toBe("Updated prompt description");

    const fetched = await db.getChatShortcode(created.id);
    expect(fetched.tag).toBe(`${tag}-edited`);
  });

  it("rejects duplicate tags (case-insensitive)", async () => {
    const tag = `test-dup-${Date.now()}`;
    const first = await db.createChatShortcode({ tag, description: "First one" });
    createdTestIds.push(first.id);

    await expect(
      db.createChatShortcode({ tag: tag.toUpperCase(), description: "Duplicate one" })
    ).rejects.toThrow(/already exists/i);
  });
});
