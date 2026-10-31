// Flow image library: CRUD over flowImages, absolute path resolution for the
// renderer, and the four angle prompts that keep a character consistent.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "flow-library-"));
process.env.DATA_DIR = dataDir;

let repo;
let imageStore;
let prompts;

beforeAll(async () => {
  repo = await import("../../src/lib/db/repos/flowImagesRepo.js");
  imageStore = await import("../../src/lib/media/imageStore.js");
  prompts = await import("../../src/lib/flow/characterPrompt.js");
});

afterAll(() => {
  // The sqlite handle stays open on Windows; a leftover temp dir is harmless.
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* EBUSY on the open db file */
  }
});

describe("flowImages repo", () => {
  it("stores, lists, finds and deletes an image", async () => {
    const created = await repo.addFlowImage({ name: "foto kucing", path: "media/images/a.png", mime: "image/png" });
    expect(created.origin).toBe("upload");

    expect(await repo.getFlowImage(created.id)).toMatchObject({ name: "foto kucing", path: "media/images/a.png" });

    const all = await repo.listFlowImages({});
    expect(all.map((row) => row.id)).toContain(created.id);

    const searched = await repo.listFlowImages({ q: "kucing" });
    expect(searched).toHaveLength(1);
    expect((await repo.listFlowImages({ q: "anjing" })).length).toBe(0);

    const removed = await repo.deleteFlowImage(created.id);
    expect(removed.id).toBe(created.id);
    expect(await repo.getFlowImage(created.id)).toBeNull();
    expect(await repo.deleteFlowImage(created.id)).toBeNull();
  });

  it("keeps character angles queryable per character", async () => {
    await repo.addFlowImage({ name: "hero front", path: "media/images/f.png", characterId: "char-1", view: "front" });
    await repo.addFlowImage({ name: "hero back", path: "media/images/b.png", characterId: "char-1", view: "back" });
    await repo.addFlowImage({ name: "lain", path: "media/images/x.png" });

    const owned = await repo.listFlowImages({ characterId: "char-1" });
    expect(owned.map((row) => row.view).sort()).toEqual(["back", "front"]);

    const removed = await repo.deleteFlowImagesByCharacter("char-1");
    expect(removed).toHaveLength(2);
    expect((await repo.listFlowImages({ characterId: "char-1" })).length).toBe(0);
  });

  it("resolves a stored path to the absolute file the renderer reads", () => {
    const written = imageStore.writeImageAssetFile({ id: "asset-1", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: "image/png" });
    expect(written.rel.startsWith("media/images/")).toBe(true);

    const abs = imageStore.resolveImageAssetPath(written.rel);
    expect(abs).toBe(written.abs);
    expect(imageStore.readImageFile(written.rel)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("character view prompts", () => {
  const character = { name: "Rani", description: "perempuan 25 tahun, jaket kulit coklat", style: "fotorealistik" };

  it("builds one prompt per view", () => {
    const all = prompts.buildViewPrompts(character);
    expect(all.map((entry) => entry.view)).toEqual(["front", "back", "left", "right"]);
    expect(new Set(all.map((entry) => entry.prompt)).size).toBe(4);
  });

  it("repeats the same subject in every view", () => {
    for (const { prompt } of prompts.buildViewPrompts(character)) {
      expect(prompt).toContain(character.name);
      expect(prompt).toContain(character.description);
      expect(prompt).toContain(character.style);
    }
  });

  it("builds a single view and refuses an unknown one", () => {
    expect(prompts.buildViewPrompt(character, "back")).toContain("back view");
    expect(() => prompts.buildViewPrompt(character, "top")).toThrow(/unknown view/);
  });

  it("refuses a character with no name or description", () => {
    expect(() => prompts.buildViewPrompts({ name: "", description: "" })).toThrow(/needs a name or a description/);
  });
});
