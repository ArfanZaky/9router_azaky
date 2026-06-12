import { chromium } from "playwright";
import { KiroService } from "./src/lib/oauth/services/kiro.js";
import { createKiroCallbackMonitor, runKiroGoogleAutomation } from "./src/lib/oauth/services/kiroGoogleAutomation.js";
import { writeFileSync } from "node:fs";

const email = "hanifherlinadema@gamaa.id";
const password = "kiropalingenak123";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

const kiroService = new KiroService();
const socialAuth = kiroService.createSocialAuthorization("google");
const callbackPromise = createKiroCallbackMonitor(context, page);

const result = await runKiroGoogleAutomation({
  page,
  authUrl: socialAuth.authUrl,
  email,
  password,
  callbackPromise,
  shortTimeoutMs: 90_000,
});

const text = await page.evaluate(() => document.body?.innerText || "");
await page.screenshot({ path: "C:/tmp/kiro-diagnose.png", fullPage: true }).catch(() => null);
writeFileSync("C:/tmp/kiro-diagnose.txt", text);

console.log(JSON.stringify({
  result,
  url: page.url(),
  textPreview: text.slice(0, 3000),
}, null, 2));

await context.close().catch(() => null);
await browser.close().catch(() => null);
