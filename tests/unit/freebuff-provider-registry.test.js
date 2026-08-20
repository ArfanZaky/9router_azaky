import { describe, expect, it } from "vitest";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import { OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("Freebuff provider registry", () => {
  it("exposes Freebuff as an OAuth provider", () => {
    expect(OAUTH_PROVIDERS.freebuff?.name).toMatch(/^Freebuff/i);
    expect(OAUTH_PROVIDERS.freebuff?.authModes).toEqual(["oauth"]);
    expect(OAUTH_PROVIDERS.freebuff?.hasOAuth).toBe(true);
  });

  it("exposes the hardcoded Freebuff model catalog", () => {
    const models = getModelsByProviderId("freebuff");
    const ids = models.map((model) => model.id);
    expect(ids).toEqual([
      "deepseek-v4-flash",
      "mimo-v2.5",
    ]);
  });

  it("keeps a default model", () => {
    const models = getModelsByProviderId("freebuff");
    expect(models.some((model) => model.default)).toBe(true);
  });

  it("resolves provider/model parse", () => {
    expect(parseModel("freebuff/deepseek-v4-flash")).toMatchObject({
      provider: "freebuff",
      model: "deepseek-v4-flash",
    });
  });

  it("registers a provider alias", () => {
    expect(PROVIDER_ID_TO_ALIAS.freebuff).toBe("freebuff");
  });
});
