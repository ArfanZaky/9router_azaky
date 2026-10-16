import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(),
  listChatSessions: vi.fn(),
}));

import { getRedmineIssues } from "@/lib/redmine/redmineClient";
import { sortIssuesByDueDate } from "@/lib/redmine/sortIssuesByDueDate";

const config = { baseUrl: "https://redmine.example", apiKey: "test", projectPaths: {} };
const originalFetch = globalThis.fetch;

beforeEach(() => { globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("Redmine due date ordering", () => {
  it("puts overdue and nearest dates first, undated tasks last, without mutating input", () => {
    const issues = [
      { id: 1, due_date: null },
      { id: 2, due_date: "2026-12-15" },
      { id: 3, due_date: "2026-01-03" },
      { id: 4, due_date: "2026-01-03" },
      { id: 5 },
    ];
    expect(sortIssuesByDueDate(issues).map((issue) => issue.id)).toEqual([3, 4, 2, 1, 5]);
    expect(issues[0].id).toBe(1);
  });

  it("reads all Redmine pages before choosing nearest dated issues", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total_count: 4, issues: [
        { id: 1, due_date: null }, { id: 2, due_date: "2026-11-01" },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total_count: 4, issues: [
        { id: 3, due_date: "2026-01-01" }, { id: 4, due_date: "2026-02-01" },
      ] }) });
    const result = await getRedmineIssues({ limit: 2, sort: "due_date:asc", customConfig: config });
    expect(result.issues.map((issue) => issue.id)).toEqual([3, 4]);
    expect(result.totalCount).toBe(4);
    expect(globalThis.fetch.mock.calls.map(([url]) => {
      const params = new URL(url).searchParams;
      return [params.get("sort"), params.get("offset")];
    })).toEqual([["due_date:asc", "0"], ["due_date:asc", "2"]]);
  });

  it("preserves normal single-page behavior for other callers", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({
      total_count: 5, issues: [{ id: 1 }, { id: 2 }],
    }) });
    const result = await getRedmineIssues({ limit: 2, customConfig: config });
    expect(result.issues.map((issue) => issue.id)).toEqual([1, 2]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
