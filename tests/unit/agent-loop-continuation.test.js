import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));
vi.mock("../../src/lib/agent/tools.js", () => ({
  executeTool: mocks.executeTool,
  getOpenAiTools: () => [{ type: "function", function: { name: "read_file", parameters: {} } }],
}));
vi.mock("../../src/lib/agent/skills.js", () => ({ buildAgentSystemPrompt: () => "agent" }));
vi.mock("../../src/lib/agent/history.js", () => ({ sanitizeToolHistory: (messages) => messages }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn() }));

const { runAgentLoop } = await import("../../src/lib/agent/loop.js");

function response(message, finishReason = "stop") {
  return new Response(JSON.stringify({ choices: [{ message, finish_reason: finishReason }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("agent loop completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeTool.mockResolvedValue("ok");
  });

  it("continues an unfinished prose handoff before completing", async () => {
    mocks.handleChat
      .mockResolvedValueOnce(response({ role: "assistant", content: "Now update the endpoint:" }))
      .mockResolvedValueOnce(response({ role: "assistant", content: "Endpoint updated and verified." }));

    const result = await runAgentLoop({
      model: "test",
      messages: [{ role: "user", content: "Update it" }],
      maxSteps: 3,
    });

    expect(mocks.handleChat).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe("Endpoint updated and verified.");
  });

  it("executes tool calls even when finish_reason is stop", async () => {
    mocks.handleChat
      .mockResolvedValueOnce(response({
        role: "assistant",
        content: "Reading file",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "read_file", arguments: "{}" } }],
      }))
      .mockResolvedValueOnce(response({ role: "assistant", content: "File checked." }));

    const result = await runAgentLoop({
      model: "test",
      messages: [{ role: "user", content: "Check file" }],
      maxSteps: 3,
    });

    expect(mocks.executeTool).toHaveBeenCalledWith("read_file", {}, expect.any(Object));
    expect(result.finalText).toBe("File checked.");
  });

  it("throws upstream failures instead of completing with partial text", async () => {
    mocks.handleChat.mockResolvedValue(new Response(JSON.stringify({ error: { message: "Provider disconnected" } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(runAgentLoop({
      model: "test",
      messages: [{ role: "user", content: "Continue" }],
    })).rejects.toThrow("Provider disconnected");
  });
});
