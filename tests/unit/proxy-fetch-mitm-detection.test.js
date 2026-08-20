import { describe, expect, it } from "vitest";

import { __test__ } from "../../open-sse/utils/proxyFetch.js";

describe("proxy fetch MITM redirect detection", () => {
  it.each(["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"])(
    "recognizes loopback address %s",
    (address) => expect(__test__.isLoopbackAddress(address)).toBe(true)
  );

  it("does not treat a public Google IP as a MITM redirect", () => {
    expect(__test__.isLoopbackAddress("172.217.119.4")).toBe(false);
  });
});
