import { describe, expect, it } from "vitest";
import type { N } from "../../scripts/twin-diff/ir.ts";
import { lowerTsFile } from "../../scripts/twin-diff/ts-ir.ts";
import { diffFeatures, features } from "../../scripts/twin-diff/features.ts";
import { canon, extractUnits } from "../../scripts/twin-diff/model.ts";
import {
  markupFeatures,
  tseToTs,
  viewTwinPath,
} from "../../scripts/twin-diff/views.ts";

const call = (
  recv: N | null,
  name: string,
  args: N[] = [],
  block: N | null = null,
): N => ({ k: "call", recv, name, args, block });
const sym = (value: string): N => ({ k: "sym", value });
const lvar = (name: string): N => ({ k: "lvar", name });
const seq = (...body: N[]): N => ({ k: "seq", body });

const tsBody = (src: string): N => {
  const units = extractUnits("x.ts", lowerTsFile("x.ts", src), "ts");
  return units.flatMap((u) => u.methods)[0].body;
};
const keys = (body: N, side: "ruby" | "ts") =>
  features(body, side)
    .items.map((f) => f.key)
    .sort();

describe("twin-diff", () => {
  it("meets Ruby and TS spellings of one name", () => {
    expect(canon("readable_by?")).toBe(canon("isReadableBy"));
    expect(canon("days_since")).toBe(canon("daysSince"));
    expect(canon("[]=")).toBe("[]");
    expect(canon("==")).toBe("==");
  });

  it("folds a hash read with a literal key into the property read", () => {
    const ruby = seq(call(call(lvar("row"), "[]", [sym("status")]), "to_s"));
    const ts = tsBody(`export function f(row) { return String(row.status); }`);
    expect(
      diffFeatures(features(ruby, "ruby").items, features(ts, "ts").items),
    ).toEqual({ missing: [], extra: [] });
  });

  it("reads a filtering push loop as select", () => {
    const ts = tsBody(
      `export function f(xs) { const out = []; for (const x of xs) if (x.ok) out.push(x); return out; }`,
    );
    expect(keys(ts, "ts")).toContain("call:select");
    expect(keys(ts, "ts")).not.toContain("call:each");
  });

  it("reads render({ locals }) as the action's ivars", () => {
    const ruby = seq(
      { k: "iasgn", name: "@owner", value: lvar("o") },
      { k: "iasgn", name: "@rows", value: lvar("r") },
    );
    const ts = tsBody(
      `export function f(o, r) { this.render({ locals: { owner: o, rows: r } }); }`,
    );
    expect(
      diffFeatures(features(ruby, "ruby").items, features(ts, "ts").items),
    ).toEqual({ missing: [], extra: [] });
  });

  it("weighs a null guard apart from a real branch", () => {
    const ts = tsBody(
      `export function f(x, n) { if (!x) return null; if (n > 3) return 1; return 2; }`,
    );
    expect(keys(ts, "ts")).toEqual(
      expect.arrayContaining(["branch:guard", "branch:if"]),
    );
  });

  it("pads a compiled template to the template's lines", () => {
    const src = `<div>\n<% if (x) { %>\n<p><%= y %></p>\n<% } %>\n</div>`;
    const code = tseToTs(src);
    const body = lowerTsFile("t.ts", code).body[0];
    expect(body.k).toBe("def");
    expect(code.split("\n")[2]).toContain("__out(y)");
  });

  it("extracts markup with dynamic attribute values and sorted classes", () => {
    const keys = markupFeatures(
      `<a class="b a" href="<%= row.href %>"><%= row.name %> open</a>`,
    ).map((f) => f.key);
    expect(keys).toEqual(['html:<a class="a b" href="§">', 'text:"§open"']);
  });

  it("maps a view path across the naming conventions", () => {
    expect(viewTwinPath("views/repo_issues/_status_badge.html.erb")).toBe(
      "views/repo-issues/_status-badge.html.tse",
    );
  });
});
