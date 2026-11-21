import { describe, expect, it } from "vitest";

import { asbToken, clipRecordsSince, imageRecordsSince, listingRecords, parseBatchexecute } from "../../src/lib/flow/composer.js";

// Shapes follow gflow 0.103 batchexecute.py (#1354, measured by gflow 2026-11-19):
// [workflowId, projectId, mediaId, _, _, [ [createdSec], …, [status] @8, _, posterUrl @10 ], _, [[… clipUrl @8]]]
const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const M1 = "44444444-4444-4444-8444-444444444444";
const M2 = "55555555-5555-4555-8555-555555555555";

const details = (createdSec, status, token) => {
  const d = new Array(11).fill(null);
  d[0] = [createdSec];
  d[8] = [status];
  d[10] = `https://lh3.googleusercontent.com/asb/${token}`;
  return d;
};
const record = (w, m, createdSec, status, token) => [w, P, m, null, null, details(createdSec, status, token), null, [[]]];

const frame = (rpcid, payload) => `)]}'\n\n123\n${JSON.stringify([["wrb.fr", rpcid, JSON.stringify(payload), null, null, null, "generic"]])}\n`;

describe("Flow project listing (Zzl0ze)", () => {
  const payload = [[record(W1, M1, 1795250000, 3, "tokA"), record(W2, M2, 1795250600, 2, "tokB")]];

  it("decodes batchexecute frames, skipping the XSSI prefix and length lines", () => {
    const frames = parseBatchexecute(frame("Zzl0ze", payload));
    expect(frames).toHaveLength(1);
    expect(frames[0].rpcid).toBe("Zzl0ze");
    expect(frames[0].payload).toEqual(payload);
  });

  it("returns no frame for an HTML error page", () => {
    expect(parseBatchexecute("<html>sign in</html>")).toEqual([]);
  });

  it("reads ids, creation time, status and poster from each record", () => {
    const records = listingRecords(payload);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ workflowId: W1, projectId: P, mediaId: M1, createdMs: 1795250000000, status: 3 });
    expect(asbToken(records[0].poster)).toBe("tokA");
  });

  it("keeps only finished clips created after the job started, oldest first", () => {
    const records = listingRecords(payload);
    // W2 is still rendering (status 2), so only W1 counts
    expect(clipRecordsSince(records, 1795249990000).map((r) => r.mediaId)).toEqual([M1]);
    // a clip made well before the job started is not the job's
    expect(clipRecordsSince(records, 1795250100000)).toEqual([]);
  });

  // Shape measured on Flow's 2026-11-20 build (project listing, read-only):
  // no status at details[8], the mime in slot 6.
  it("tells images from clips by mime when the record carries no status", () => {
    const d = new Array(14).fill(null);
    d[0] = [1795258025, 659548000];
    d[5] = "https://lh3.googleusercontent.com/asb/tokImg";
    d[10] = "https://lh3.googleusercontent.com/asb/tokImg";
    const media = new Array(19).fill(null);
    media[11] = M2;
    media[18] = "image/jpeg";
    const image = [W2, P, M2, null, null, d, [media, null, [1376, 768]]];
    const records = listingRecords([[image]]);
    expect(records[0]).toMatchObject({ kind: "image", status: null, mime: "image/jpeg" });
    expect(asbToken(records[0].poster)).toBe("tokImg");
    expect(clipRecordsSince(records, 1795258000000)).toEqual([]);
    expect(imageRecordsSince(records, 1795258000000)).toHaveLength(1);
  });
});

describe("asbToken", () => {
  it("strips the size spec from a grid tile URL", () => {
    expect(asbToken("https://flow.google.com/asb/AbC_123-x=w512-h288")).toBe("AbC_123-x");
  });

  it("matches the listing poster form of the same token", () => {
    expect(asbToken("https://lh3.googleusercontent.com/asb/AbC_123-x")).toBe("AbC_123-x");
  });

  it("is null for other URLs", () => {
    expect(asbToken("https://flow-content.google/video/" + M1)).toBeNull();
    expect(asbToken("not a url")).toBeNull();
  });
});
