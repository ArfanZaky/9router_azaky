// Google Flow video jobs.
//
// Flow has no REST API: submit is reCAPTCHA-gated with a single-use token, so
// the request has to come from the real web app. That work happens in
// src/lib/flow/bridge.js, which owns the browser and the serial queue.
//
// The call is in-process on purpose. A loopback HTTP hop would need its own
// port, its own auth, and a second listener on a server whose /api/* is
// deny-by-default — for a provider that has no reachable upstream anyway. So
// this adapter hands back a `handle()` (videoCore calls it instead of fetch):
//
//   create → bridge.handleFlowRequest({ action, rawBody, contentType })
//   poll   → bridge.handleFlowRequest({ requestId })
//
// The response is already the async-job shape videoCore passes through, so
// there is no transformResponse.
import { handleFlowRequest } from "@/lib/flow/bridge";

export default {
  async buildRequest({ action, requestId, rawBody, contentType }) {
    return {
      handle: ({ signal }) => handleFlowRequest({ action, requestId, rawBody, contentType, signal }),
    };
  },
};
