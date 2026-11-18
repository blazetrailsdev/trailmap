import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";

/**
 * docs/style-guide.md, the parts a machine can hold: three type sizes, the
 * listed radii, no uppercase, borders rather than coloured edges or dashes,
 * no weight past 600, and `.ctl` as the one form control. Rendered
 * markdown (`.markdown`) keeps its document headings and is left out.
 */
const STYLESHEET = "app/assets/stylesheets/application.css";

async function rules(): Promise<string[]> {
  const css = (await getFs().readFile(STYLESHEET, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  return css.split("}").filter((rule) => !rule.includes(".markdown"));
}

async function viewSources(dir: string): Promise<string[]> {
  const fs = getFs();
  const out: string[] = [];
  for (const name of await fs.readdir!(dir)) {
    const path = `${dir}/${name}`;
    if (/\.(tse|erb)$/.test(name)) out.push(path);
    else if (!name.includes(".")) out.push(...(await viewSources(path)));
  }
  return out;
}

describe("the style guide", () => {
  it("uses only the guide's three type sizes", async () => {
    const sizes = (await rules()).flatMap((rule) => [...rule.matchAll(/font-size:\s*([^;}\n]+)/g)].map((m) => m[1].trim()));
    expect(sizes.filter((size) => /\d/.test(size) && !["12px", "14px", "16px"].includes(size))).toEqual([]);
  });

  it("uses only the guide's radii", async () => {
    const radii = (await rules()).flatMap((rule) => [...rule.matchAll(/border-radius:\s*([^;}\n]+)/g)].map((m) => m[1].trim()));
    const allowed = /^(0|50%|inherit|(?:(?:6px|12px|2em|0)\s*){1,4})$/;
    expect(radii.filter((radius) => !allowed.test(radius))).toEqual([]);
  });

  it("writes no uppercase and no letter-spacing", async () => {
    const css = (await rules()).join("}");
    expect(css).not.toMatch(/text-transform:\s*uppercase|letter-spacing:/);
  });

  it("draws no coloured row edge, dashed line or bold weight", async () => {
    const edge = /border-(?:left|inline-start)(?:-color)?:\s*([^;}\n]+)/g;
    const plainEdge = /^(?:none|0|transparent|(?:\d+px\s+solid\s+)?var\(--(?:border|line)\))$/;
    const offenders = (await rules()).flatMap((rule) => {
      const selector = rule.trim().split("{")[0].trim();
      const edges = [...rule.matchAll(edge)].map((m) => m[1].trim()).filter((v) => !plainEdge.test(v));
      const dashes = /:[^;{}]*\bdashed\b/.test(rule);
      const bold = /font-weight:\s*(?:[7-9]00|bold(?:er)?)\b/.test(rule);
      return edges.length > 0 || dashes || bold ? [selector] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("has no view that uses class=\"input\"", async () => {
    const fs = getFs();
    const offenders: string[] = [];
    const paths = [...(await viewSources("app/views")), ...(await viewSources("rails/app/views"))];
    expect(paths.length).toBeGreaterThan(80);
    for (const path of paths) {
      if (/class="input\b/.test(await fs.readFile(path, "utf8"))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
