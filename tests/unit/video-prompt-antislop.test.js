import { describe, it, expect } from "vitest";
import {
  sanitizeAntislopText,
  sanitizeStoryboardOutput,
  applyAntislopImagePrompt,
  applyAntislopVideoPrompt,
  getDirectorPersonaInstruction,
} from "../../src/lib/videoPrompt/antislop.js";
import { buildViewPrompt } from "../../src/lib/flow/characterPrompt.js";

describe("video-prompt antislop utilities", () => {
  it("strips AI buzzwords, render-engine filler, and em dashes from text", () => {
    const raw =
      "A breathtaking, ultra-detailed — hyper-realistic portrait in Unreal Engine 5, masterpiece, 8k uhd, of an auditor.";
    const cleaned = sanitizeAntislopText(raw);
    expect(cleaned).not.toMatch(/breathtaking|ultra-detailed|hyper-realistic|unreal engine 5|masterpiece|8k uhd/i);
    expect(cleaned).not.toContain("—");
    expect(cleaned).toContain("portrait");
    expect(cleaned).toContain("of an auditor.");
  });

  it("sanitizes storyboard output and every scene prompt field", () => {
    const parsed = {
      projectTitle: "Stunning — Audit Storyboard",
      characterConsistencyPrompt: "Rina, hyper-detailed charcoal suit, masterpiece",
      scenes: [
        {
          sceneNumber: 1,
          summary: "Rina enters — breathtaking boardroom",
          imagePrompt: "Medium shot, 50mm lens, ultra-detailed, trending on artstation, --ar 16:9",
          motionPrompt: "Slow dolly in — jaw-dropping lighting, octane render",
          camera: "50mm — Tracking",
          lighting: "Practical tungsten, photorealistic",
          audioSfx: "Rain on glass — low hum",
          voiceover: "We start at eight — sharp.",
        },
      ],
    };

    const out = sanitizeStoryboardOutput(parsed);
    expect(out.projectTitle).toBe("Audit Storyboard");
    expect(out.characterConsistencyPrompt).toBe("Rina, charcoal suit");
    expect(out.scenes[0].imagePrompt).toBe("Medium shot, 50mm lens, --ar 16:9");
    expect(out.scenes[0].motionPrompt).toBe("Slow dolly in, lighting");
    expect(out.scenes[0].voiceover).not.toContain("—");
  });

  it("applies antislop image and video negative prompt guards", () => {
    const imgPrompt = applyAntislopImagePrompt(
      "35mm medium shot of a watchmaker at a bench, masterpiece, unreal engine",
      "oversaturated neon"
    );
    expect(imgPrompt).not.toMatch(/masterpiece|unreal engine/i);
    expect(imgPrompt).toContain("Natural surface texture, physically grounded lighting");
    expect(imgPrompt).toContain("Avoid: oversaturated neon");

    const vidPrompt = applyAntislopVideoPrompt(
      "Locked tripod shot — horologist adjusts balance wheel, jaw-dropping, 8k uhd",
      "flickering limbs"
    );
    expect(vidPrompt).not.toMatch(/jaw-dropping|8k uhd/i);
    expect(vidPrompt).not.toContain("—");
    expect(vidPrompt).toContain("Avoid: flickering limbs");
  });

  it("cleans character turnaround prompts in buildViewPrompt", () => {
    const prompt = buildViewPrompt(
      {
        name: "Aruna — Lead",
        description: "25yo courier, stunning brown leather jacket, ultra-detailed",
        style: "35mm film, masterpiece",
      },
      "front"
    );
    expect(prompt).not.toMatch(/stunning|ultra-detailed|masterpiece/i);
    expect(prompt).not.toContain("—");
    expect(prompt).toContain("front view, facing the camera");
  });

  it("returns concrete director persona instructions", () => {
    expect(getDirectorPersonaInstruction("documentary")).toContain("observational framing");
    expect(getDirectorPersonaInstruction("unknown_key")).toContain("measured unhurried");
  });
});
