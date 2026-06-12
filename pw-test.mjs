import { chromium } from "playwright";

console.log("before-launch");
const browser = await chromium.launch({ headless: false });
console.log("after-launch");
await browser.close();
console.log("after-close");
