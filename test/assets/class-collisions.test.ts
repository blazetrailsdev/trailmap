import { describe, expect, it } from "vitest";
import { Dir, getFs } from "@blazetrails/ruby-compat";

/**
 * A CSS class collision is invisible to every other check: the markup is
 * right, the strings a unit test asserts are right, and the page is wrong.
 * trailmap#47 gave the reviewer row's empty cell `class="pcell empty"` while
 * `.empty` was the list pages' empty-state block, so every reviewer line
 * inherited 32px of padding. Only a screenshot saw it.
 *
 * A class with a rule of its own setting `padding`, `display` or `position`
 * lays out a box; an element wearing two of them is two components on one
 * node, unless the pair is listed below as a deliberate modifier. Not seen:
 * the run-time part of a class list (a list is read up to the quote ending
 * its literal), and rules that are not bare `.name` selectors.
 */
const STYLESHEET = "app/assets/stylesheets/application.css";
const SOURCES = ["app/views/**/*.tse", "app/assets/javascripts/*.js"];

/** Pairs that are one component and its modifier, each naming why. */
const DELIBERATE = new Set([
  "btn btn-sm", // `.btn-sm` is `.btn` with less padding.
]);

/** The classes with a bare `.name` rule that sets a box property. */
export function boxClasses(css: string): Set<string> {
  const found = new Set<string>();
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectors, body] of rules) {
    if (!/(^|;)\s*(padding|display|position)\s*:/.test(body)) continue;
    for (const selector of selectors.split(",")) {
      const bare = /^\.([\w-]+)$/.exec(selector.trim());
      if (bare) found.add(bare[1]);
    }
  }
  return found;
}

/** Every class list in `source` that wears two box classes, sorted and joined. */
export function collisionsIn(source: string, box: Set<string>): string[] {
  const out: string[] = [];
  for (const [, list] of source.matchAll(/(?:class=\\?"|cls: "|className = ")([^"'\\]*)/g)) {
    const worn = list.replace(/<%.*?%>/g, " ").split(/\s+/).filter((name) => box.has(name));
    if (worn.length > 1) out.push(worn.sort().join(" "));
  }
  return out;
}

describe("the CSS class space", () => {
  it("has no element wearing two classes that each lay out their own box", async () => {
    const box = boxClasses(await getFs().readFile(STYLESHEET, "utf8"));
    const files = SOURCES.flatMap((pattern) => Dir.glob(pattern));
    expect(files.length).toBeGreaterThan(20);

    const found: string[] = [];
    for (const file of files) {
      for (const pair of collisionsIn(await getFs().readFile(file, "utf8"), box)) {
        if (!DELIBERATE.has(pair)) found.push(`${file}: class="${pair}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it("goes red on the collision that shipped in trailmap#47", async () => {
    const box = boxClasses(await getFs().readFile(STYLESHEET, "utf8"));

    expect(collisionsIn(`'<div class="pcell empty"><span class="plabel">'`, box)).toEqual(["empty pcell"]);
    expect(collisionsIn(`<div class="pcell unassigned">`, box)).toEqual([]);
  });
});
