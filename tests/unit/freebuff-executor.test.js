import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

import { FreebuffExecutor, __test__ } from "../../open-sse/executors/freebuff.js";
import { FREEBUFF_SYSTEM_MARKER } from "../../open-sse/config/freebuffConstants.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FreebuffExecutor", () => {
  beforeEach(() => fetchMock.mockReset());

  it("maps limited-tier model IDs to their canonical agent pair", () => {
    expect(__test__.parseModel("deepseek-v4-flash")).toEqual({
      model: "deepseek/deepseek-v4-flash",
      agentId: "base2-free-deepseek-flash",
    });
  });

  it("injects the exact CLI gate marker before an existing system prompt", () => {
    const output = __test__.injectSystemMarker({
      messages: [{ role: "system", content: "Follow the caller instructions." }],
    });
    expect(output.messages[0].content).toMatch(new RegExp(`^${FREEBUFF_SYSTEM_MARKER}`));
    expect(output.messages[0].content).toContain("Follow the caller instructions.");
  });

  it("creates the CLI session/run/chat envelope", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "none", accessTier: "limited" }))
      .mockResolvedValueOnce(jsonResponse({
        status: "active",
        instanceId: "instance-1",
        model: "deepseek/deepseek-v4-flash",
      }))
      .mockResolvedValueOnce(jsonResponse({ runId: "run-1" }))
      .mockResolvedValueOnce(new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));

    const executor = new FreebuffExecutor();
    const result = await executor.execute({
      model: "deepseek-v4-flash",
      body: { messages: [{ role: "user", content: "ping" }], stream: false },
      credentials: {
        accessToken: "token-1",
        providerSpecificData: { userId: "user-1" },
      },
      signal: new AbortController().signal,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][1].headers["x-freebuff-model"]).toBe("deepseek/deepseek-v4-flash");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      action: "START",
      agentId: "base2-free-deepseek-flash",
      ancestorRunIds: [],
    });
    expect(fetchMock.mock.calls[2][1].headers["x-freebuff-acting-user-id"]).toBe("user-1");

    const chatCall = fetchMock.mock.calls[3];
    const upstream = JSON.parse(chatCall[1].body);
    expect(upstream.stream).toBe(true);
    expect(upstream.messages[0].content).toMatch(new RegExp(`^${FREEBUFF_SYSTEM_MARKER}`));
    expect(upstream.codebuff_metadata).toMatchObject({
      freebuff_instance_id: "instance-1",
      run_id: "run-1",
      cost_mode: "free",
    });
    expect(upstream.provider).toEqual({ data_collection: "deny" });
    expect(chatCall[1].headers["x-freebuff-acting-user-id"]).toBe("user-1");
    expect(result.response.status).toBe(200);
  });
});
