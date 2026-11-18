import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";

/**
 * The parity page's stylesheet: ringo's generated parity.css sits in a
 * cascade layer under application.css, and every token it defines is either
 * one application.css themes or one parity-page.css themes for data-theme.
 */
const PAGE = "app/assets/stylesheets/parity-page.css";
const RINGO = "app/assets/stylesheets/parity.css";
const APP = "app/assets/stylesheets/application.css";

function strip(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function tokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("the parity page stylesheet", () => {
  it("imports parity.css into a layer", async () => {
    const css = strip(await getFs().readFile(PAGE, "utf8"));
    expect(css).toMatch(/@import url\("parity\.css"\) layer\(ringo\);/);
  });

  it("is the only sheet either parity view links", async () => {
    const fs = getFs();
    const tse = await fs.readFile("app/views/parity-graphs/show.html.tse", "utf8");
    const erb = await fs.readFile("rails/app/views/parity_graphs/show.html.erb", "utf8");
    expect(tse).toContain('viteStylesheetTag("~/stylesheets/parity-page.css")');
    expect(tse).not.toMatch(/stylesheets\/parity\.css/);
    expect(erb).toContain('stylesheet_link_tag "parity-page"');
    expect(erb).not.toMatch(/stylesheet_link_tag "parity"/);
  });

  it("themes every ringo token for data-theme", async () => {
    const fs = getFs();
    const ringo = tokens(strip(await fs.readFile(RINGO, "utf8")));
    const app = strip(await fs.readFile(APP, "utf8"));
    const page = strip(await fs.readFile(PAGE, "utf8"));
    const appDark = tokens(block(app, ':root[data-theme="dark"]'));
    const pageLight = tokens(block(page, ":root {"));
    const pageDark = tokens(block(page, ':root[data-theme="dark"]'));
    const appAll = tokens(app);
    const missing = [...ringo].filter(
      (token) => !appAll.has(token) && !pageLight.has(token),
    );
    expect(missing).toEqual([]);
    const unthemed = [...pageLight].filter((token) => !pageDark.has(token) && !appDark.has(token));
    expect(unthemed).toEqual(["--axis"]);
    const axis = block(page, ":root {").match(/--axis:\s*var\((--[a-z0-9-]+)\)/);
    expect(axis && appDark.has(axis[1])).toBe(true);
  });

  it("gives a dark OS the same values as data-theme=\"dark\"", async () => {
    const page = strip(await getFs().readFile(PAGE, "utf8"));
    const decls = (css: string) => [...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => `${m[1]}:${m[2].trim()}`).sort();
    expect(decls(block(page, ':root:not([data-theme="light"])'))).toEqual(decls(block(page, ':root[data-theme="dark"]')));
  });
});
