import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";

/**
 * docs/style-guide.md, the parts a machine can hold: three type sizes, the
 * listed radii, no uppercase, and `.ctl` as the one form control. Rendered
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
