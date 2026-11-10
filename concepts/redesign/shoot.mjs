// Screenshots every concept/state: node concepts/redesign/shoot.mjs (needs playwright resolvable).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = [
  ["b-stepper-list.html", "", "b-stepper-collapsed"],
  ["b-stepper-list.html", "?open=s3", "b-stepper-expanded"],
  ["c-soil-dark.html", "", "c-soil-collapsed"],
  ["c-soil-dark.html", "?open=s3", "c-soil-expanded"],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const [file, q, out] of shots) {
  await page.goto("file://" + path.join(dir, file) + q);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(dir, "screenshots", out + ".png"), fullPage: true });
}
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
for (const [q, out] of [["", "b-stepper-mobile-collapsed"], ["?open=s3", "b-stepper-mobile-expanded"]]) {
  await m.goto("file://" + path.join(dir, "b-stepper-list.html") + q);
  await m.waitForLoadState("networkidle");
  await m.screenshot({ path: path.join(dir, "screenshots", out + ".png"), fullPage: true });
}
await page.goto("file://" + path.join(dir, "b-stepper-list.html?search=1"));
await page.waitForLoadState("networkidle");
await page.screenshot({ path: path.join(dir, "screenshots", "b-search-desktop.png") });
await m.goto("file://" + path.join(dir, "b-stepper-list.html?search=1"));
await m.waitForLoadState("networkidle");
await m.screenshot({ path: path.join(dir, "screenshots", "b-search-mobile.png") });
await browser.close();
