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

    return {
      created: nowSec(),
      data: [
        {
          url: img.url,
          b64_json: img.b64_json,
          ...(img.mime ? { mime_type: img.mime } : {}),
        },
      ],
    };
  },
};
