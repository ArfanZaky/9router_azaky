// Google Flow image adapter — delegates to src/lib/flow/bridge.js (serial queue + browser session).
import { nowSec } from "./_base.js";
import { generateFlowImage } from "@/lib/flow/bridge";

export default {
  useExecutor: true,
  noAuth: true,

  // Stubs required by imageGenerationCore interface
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),
  normalize: (responseBody) => responseBody,

  async executeViaExecutor(model, body) {
    const img = await generateFlowImage({
      ...body,
      model: model || body.model,
    });

    const images = img.images?.length ? img.images : [img];
    return {
      created: nowSec(),
      data: images.map((item) => ({
        url: item.url,
        b64_json: item.b64_json,
        ...(item.mime ? { mime_type: item.mime } : {}),
      })),
    };
  },
};
