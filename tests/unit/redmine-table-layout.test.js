import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Redmine Tasks Table Layout", () => {
  const filePath = path.resolve(process.cwd(), "../src/app/(dashboard)/dashboard/redmine/RedminePageClient.js");
  const content = fs.readFileSync(filePath, "utf-8");

  it("does not contain standalone # ID, Priority, or Updated columns in the tasks table header", () => {
    // Extract the Tasks table header (<table ... thead)
    const taskTheadMatch = content.match(/<table className="w-full text-left text-xs">\s*<thead[\s\S]*?<\/thead>/);
    expect(taskTheadMatch).toBeTruthy();
    const thead = taskTheadMatch[0];

    // Verify removed columns are absent from tasks table header
    expect(thead).not.toMatch(/<th[^>]*># ID<\/th>/);
    expect(thead).not.toMatch(/<th[^>]*>Priority<\/th>/);
    expect(thead).not.toMatch(/<th[^>]*>Updated<\/th>/);

    // Verify essential columns remain present
    expect(thead).toContain("Tracker & Project");
    expect(thead).toContain("Subject");
    expect(thead).toContain("Status");
    expect(thead).toContain("Due Date");
    expect(thead).toContain("Log Time");
    expect(thead).toContain("% Done");
    expect(thead).toContain("Action");
  });

  it("places Due Date column immediately to the right of Status in the tasks table header", () => {
    const taskTheadMatch = content.match(/<table className="w-full text-left text-xs">\s*<thead[\s\S]*?<\/thead>/);
    expect(taskTheadMatch).toBeTruthy();
    const thead = taskTheadMatch[0];

    const statusIdx = thead.indexOf('<th className="px-4 py-3.5">Status</th>');
    const dueDateIdx = thead.indexOf('<th className="px-4 py-3.5 whitespace-nowrap">Due Date</th>');
    const logTimeIdx = thead.indexOf('<th className="px-4 py-3.5 whitespace-nowrap">Log Time</th>');
    const doneIdx = thead.indexOf('<th className="px-4 py-3.5 w-28">% Done</th>');
    const actionIdx = thead.indexOf('Action');

    expect(statusIdx).toBeGreaterThan(0);
    expect(dueDateIdx).toBeGreaterThan(statusIdx);
    expect(logTimeIdx).toBeGreaterThan(dueDateIdx);
    expect(doneIdx).toBeGreaterThan(logTimeIdx);
    expect(actionIdx).toBeGreaterThan(doneIdx);
  });

  it("places Due Date cell immediately after Status in the tasks table body", () => {
    const statusIdx = content.indexOf('issue.status?.name || "Open"');
    const dueDateIdx = content.indexOf('{issue.due_date ? new Date');
    const logTimeIdx = content.indexOf('openLogTimeModal(issue, e)');

    expect(statusIdx).toBeGreaterThan(0);
    expect(dueDateIdx).toBeGreaterThan(statusIdx);
    expect(logTimeIdx).toBeGreaterThan(dueDateIdx);
  });

  it("pins the Action column to the right using sticky right positioning with proper background", () => {
    // Check Action th in Tasks table
    expect(content).toMatch(/<th[^>]*sticky right-0[^>]*>\s*Action\s*<\/th>/);

    // Check Action td in Tasks table
    expect(content).toMatch(/<td[^>]*sticky right-0[^>]*bg-surface[^>]*group-hover:bg-surface-2/);

    // Check Actions th in Projects table
    expect(content).toMatch(/<th[^>]*sticky right-0[^>]*>\s*Actions\s*<\/th>/);

    // Check Actions td in Projects table
    expect(content).toMatch(/<td[^>]*sticky right-0[^>]*bg-surface[^>]*group-hover:bg-surface-2/);
  });

  it("still preserves issue id inside the Tracker & Project cell for user reference", () => {
    expect(content).toMatch(/#{issue\.id}/);
  });
});
