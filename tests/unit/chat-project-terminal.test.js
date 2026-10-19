import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Project Terminal API & Components", () => {
  test("route.js file exists and exports GET and POST", async () => {
    const routePath = path.resolve("src/app/api/chat/projects/terminal/route.js");
    assert.ok(fs.existsSync(routePath), "terminal route.js must exist");

    const content = fs.readFileSync(routePath, "utf8");
    assert.match(content, /export async function GET/, "Must export GET");
    assert.match(content, /export async function POST/, "Must export POST");
    assert.match(content, /launchSystemTerminal/, "Must have launchSystemTerminal helper");
  });

  test("ProjectTerminalView.js exists and has clean Anti-Slop copy", () => {
    const viewPath = path.resolve("src/app/(dashboard)/dashboard/chat/ProjectTerminalView.js");
    assert.ok(fs.existsSync(viewPath), "ProjectTerminalView.js must exist");

    const content = fs.readFileSync(viewPath, "utf8");
    assert.match(content, /handleLaunchTerminal/, "Must have handleLaunchTerminal");
    assert.match(content, /handleExecuteCommand/, "Must have handleExecuteCommand");
    assert.match(content, /quickCommands/, "Must have quickCommands");
    // Anti-slop R-02: No em dashes
    assert.doesNotMatch(content, /—/, "Anti-slop R-02: No em dash allowed");
  });

  test("ProjectSidebar.js includes Terminal tab", () => {
    const sidebarPath = path.resolve("src/app/(dashboard)/dashboard/chat/ProjectSidebar.js");
    const content = fs.readFileSync(sidebarPath, "utf8");

    assert.match(content, /id:\s*"terminal"/, "TABS must contain terminal id");
    assert.match(content, /ProjectTerminalView/, "Must import and use ProjectTerminalView");
    assert.match(content, /tab === "terminal"/, "Must render terminal view on terminal tab");
    assert.doesNotMatch(content, /—/, "Anti-slop R-02: No em dash in copy");
  });

  test("ChatPageClient.js header includes Terminal tab button", () => {
    const chatClientPath = path.resolve("src/app/(dashboard)/dashboard/chat/ChatPageClient.js");
    const content = fs.readFileSync(chatClientPath, "utf8");

    assert.match(content, /toggleProject\("terminal"\)/, "Must have button calling toggleProject('terminal')");
    assert.match(content, />\s*Terminal\s*<\/Button>/, "Must have Terminal button label");
  });
});
