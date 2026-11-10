// Screenshots every concept/state: node concepts/redesign/shoot.mjs (needs playwright resolvable).
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = [
  ["a-pipeline.html", "", "a-pipeline-collapsed"],
  ["a-pipeline.html", "?open=s3", "a-pipeline-expanded"],
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
  await page.screenshot({ path: path.join(dir, "screenshots", out + ".png"), fullPage: !out.startsWith("a-pipeline-expanded") });
}
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
for (const [q, out] of [["", "b-stepper-mobile-collapsed"], ["?open=s3", "b-stepper-mobile-expanded"]]) {
  await m.goto("file://" + path.join(dir, "b-stepper-list.html") + q);
  await m.waitForLoadState("networkidle");
  await m.screenshot({ path: path.join(dir, "screenshots", out + ".png"), fullPage: true });
}
await browser.close();
