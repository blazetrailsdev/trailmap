// Screenshots every concept and state, and fails if a phone-width page
// overflows. See README.md for running it.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH ?? "playwright");
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.SHOTS_DIR ?? path.join(dir, "screenshots");
mkdirSync(out, { recursive: true });
const url = (file) => "file://" + path.join(dir, file);

const desktop = [
  ["b-stepper-list.html", "b-stepper-collapsed", true],
  ["b-stepper-list.html?open=s3", "b-stepper-expanded", true],
  ["b-stepper-list.html?filter=needs", "b-stepper-needs-you", true],
  ["b-stepper-list.html?search=1", "b-search-desktop", false],
  ["c-soil-dark.html", "c-soil-collapsed", true],
  ["c-soil-dark.html?open=s3", "c-soil-expanded", true],
];
const mobile = [
  ["b-stepper-list.html", "b-stepper-mobile-collapsed", true],
  ["b-stepper-list.html?open=s3", "b-stepper-mobile-expanded", true],
  ["b-stepper-list.html?search=1", "b-search-mobile", false],
];

const browser = await chromium.launch();
const failures = [];
const shoot = async (page, [file, name, fullPage], checkWidth) => {
  await page.goto(url(file));
  await page.waitForLoadState("networkidle");
  if (checkWidth) {
    const { inner, scroll } = await page.evaluate(() => ({
      inner: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    const ok = inner === 390 && scroll <= inner;
    console.log(`${name}: innerWidth ${inner}, scrollWidth ${scroll}${ok ? "" : "  FAIL"}`);
    if (!ok) failures.push(name);
  }
  await page.screenshot({ path: path.join(out, name + ".png"), fullPage });
};

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const shot of desktop) await shoot(page, shot, false);
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
for (const shot of mobile) await shoot(phone, shot, true);
await browser.close();

if (failures.length) {
  console.error(`horizontal overflow at 390px: ${failures.join(", ")}`);
  process.exit(1);
}
