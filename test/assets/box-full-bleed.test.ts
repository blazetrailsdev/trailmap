import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { STYLESHEET } from "../../scripts/class-collisions.ts";

/**
 * The phone full-bleed rule was dead for months: a second `.box { ... }` came
 * later in the file and won the cascade, and nothing noticed. These hold the
 * two things that keep it alive — one `.box` declaration, and the phone rule
 * after it.
 */
async function stylesheet(): Promise<string> {
  return getFs().readFile(STYLESHEET, "utf8");
}

/** Every rule as [selector, body, offset], comments dropped. */
function rules(css: string): Array<[string, string, number]> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, (c) => " ".repeat(c.length));
  return [...bare.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => [
    m[1].trim(),
    m[2],
    m.index ?? 0,
  ]);
}

describe("the .box full-bleed rule", () => {
  it("declares .box exactly once", async () => {
    const declarations = rules(await stylesheet()).filter(
      ([selector]) => selector === ".box",
    );
    expect(declarations).toHaveLength(1);
  });

  it("puts the phone full-bleed rule after the .box declaration", async () => {
    const all = rules(await stylesheet());
    const box = all.find(([selector]) => selector === ".box");
    const bleed = all.find(
      ([selector, body]) =>
        selector === ".wrap > .box" && /margin: 0 -16px/.test(body),
    );
    expect(box).toBeDefined();
    expect(bleed).toBeDefined();
    expect(bleed![2]).toBeGreaterThan(box![2]);
  });

  it("bleeds only a box that is a direct child of .wrap", async () => {
    const bleeding = rules(await stylesheet())
      .filter(
        ([selector, body]) =>
          /\.box\b/.test(selector) && /margin: 0 -16px/.test(body),
      )
      .map(([selector]) => selector);
    expect(bleeding).toEqual([".wrap > .box"]);
  });
});
