import { describe, it, expect } from "vitest";

describe("Motion History Logic", () => {
  it("caps history at 50 items and preserves newest first", () => {
    let history = [];
    for (let i = 0; i < 60; i++) {
      const entry = {
        id: `motion-${i}`,
        prompt: `Animation ${i}`,
        model: "openai/gpt-4o",
        code: `export const MyComp = () => <div />`,
        size: "1920x1080",
        seconds: 5,
        createdAt: 1000 + i,
      };
      history = [entry, ...history.filter((x) => x.id !== entry.id)].slice(0, 50);
    }
    expect(history.length).toBe(50);
    expect(history[0].id).toBe("motion-59");
    expect(history[49].id).toBe("motion-10");
  });

  it("attaches rendered video to target history item", () => {
    const history = [
      { id: "motion-1", prompt: "Test", code: "code1" },
      { id: "motion-2", prompt: "Test 2", code: "code2" },
    ];
    const targetId = "motion-1";
    const video = { url: "/api/video-prompt/media/test.mp4", size: 102400 };

    const updated = history.map((item) =>
      item.id === targetId ? { ...item, videoUrl: video.url, videoSize: video.size } : item
    );

    expect(updated[0].videoUrl).toBe("/api/video-prompt/media/test.mp4");
    expect(updated[0].videoSize).toBe(102400);
    expect(updated[1].videoUrl).toBeUndefined();
  });

  it("filters history by keyword matching prompt or model", () => {
    const history = [
      { id: "1", prompt: "Neon glowing title intro", model: "claude-3-7-sonnet" },
      { id: "2", prompt: "Cyberpunk particle stream", model: "gpt-4o" },
      { id: "3", prompt: "Product feature cards", model: "claude-3-7-sonnet" },
    ];

    const filterBy = (q) => {
      const query = q.toLowerCase();
      return history.filter(
        (item) =>
          item.prompt.toLowerCase().includes(query) ||
          item.model.toLowerCase().includes(query)
      );
    };

    expect(filterBy("neon").length).toBe(1);
    expect(filterBy("claude").length).toBe(2);
    expect(filterBy("nonexistent").length).toBe(0);
  });
});
