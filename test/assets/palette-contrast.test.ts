import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { STYLESHEET } from "../../scripts/class-collisions.ts";

const css = await getFs().readFile(STYLESHEET, "utf8");

function block(selector: string): Record<string, string> {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error("no block " + selector);
  const body = css.slice(at, css.indexOf("}", at));
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) tokens[m[1]] = m[2].toLowerCase();
  return tokens;
}

const light = block(":root");
const darkForced = block(':root[data-theme="dark"]');
const darkMedia = block(':root:not([data-theme="light"])');
const dark = { ...light, ...darkForced };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TEXT = ["ink", "ink-2", "ink-3", "green", "yellow-ink"];
const MARKS = ["st-drafting", "st-self", "st-ringo", "st-ci", "st-ready", "st-merged"];

describe("palette tokens", () => {
  it("forced dark and media dark are the same set", () => {
    expect(darkMedia).toEqual(darkForced);
  });

  for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
    for (const ground of ["bg", "surface"]) {
      for (const t of TEXT) {
        it(`${name}: --${t} on --${ground} meets 4.5:1`, () => {
          expect(contrast(theme[t], theme[ground])).toBeGreaterThanOrEqual(4.5);
        });
      }
      for (const m of MARKS) {
        it(`${name}: --${m} on --${ground} meets 3:1`, () => {
          expect(contrast(theme[m], theme[ground])).toBeGreaterThanOrEqual(3);
        });
      }
    }
    for (const m of MARKS) {
      it(`${name}: --on-mark on --${m} meets 3:1`, () => {
        expect(contrast(theme["on-mark"], theme[m])).toBeGreaterThanOrEqual(3);
      });
    }
  }

  it("white on the action fill meets 4.5:1", () => {
    expect(contrast("#ffffff", light.action)).toBeGreaterThanOrEqual(4.5);
  });
});
