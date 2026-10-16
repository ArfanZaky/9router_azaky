import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listChatSessions: vi.fn(),
}));

import { getRedmineProjectAssignees, updateRedmineIssue } from "@/lib/redmine/redmineClient";

const config = { baseUrl: "https://redmine.example", apiKey: "test" };
const originalFetch = globalThis.fetch;

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Redmine assignment", () => {
  it("sends an assignee ID, and supports explicitly clearing an assignment", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 204 });
    await updateRedmineIssue(42, { assignedToId: "17" }, config);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ issue: { assigned_to_id: 17 } });
    await updateRedmineIssue(42, { assignedToId: null }, config);
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual({ issue: { assigned_to_id: "" } });
    await updateRedmineIssue(42, { notes: "Hi" }, config);
    expect(JSON.parse(globalThis.fetch.mock.calls[2][1].body)).toEqual({ issue: { notes: "Hi" } });
  });

  it("rejects invalid assignment IDs without contacting Redmine", async () => {
    await expect(updateRedmineIssue(42, { assignedToId: "../2" }, config)).rejects.toThrow("Invalid assignedToId");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetches all project memberships, including groups, without duplicates", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total_count: 3, memberships: [{ user: { id: 9, name: "Zoe" } }, { group: { id: 7, name: "Team" } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total_count: 3, memberships: [{ user: { id: 9, name: "Zoe" } }] }) });
    await expect(getRedmineProjectAssignees(2, config)).resolves.toEqual([
      { id: 7, name: "Team", type: "group" },
      { id: 9, name: "Zoe", type: "user" },
    ]);
    expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://redmine.example/projects/2/memberships.json?limit=100&offset=0",
      "https://redmine.example/projects/2/memberships.json?limit=100&offset=2",
    ]);
  });

  it("reports membership permission failures rather than showing an empty picker", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden", text: async () => "Denied" });
    await expect(getRedmineProjectAssignees(2, config)).rejects.toThrow("Failed to fetch project members (403): Denied");
  });
});
