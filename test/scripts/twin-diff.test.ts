import { describe, expect, it } from "vitest";
import {
  Dir,
  env,
  getChildProcess,
  getFs,
  getPath,
} from "@blazetrails/ruby-compat";
import type { N } from "../../scripts/twin-diff/ir.ts";
import { lowerTsFile } from "../../scripts/twin-diff/ts-ir.ts";
import { diffFeatures, features } from "../../scripts/twin-diff/features.ts";
import {
  canon,
  constName,
  extractUnits,
} from "../../scripts/twin-diff/model.ts";
import { foldCall } from "../../scripts/twin-diff/idioms.ts";
import type { TwinContext } from "../../scripts/twin-diff/idioms.ts";
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

  it("names a constant, aliasing Ruby's root error to JS's", () => {
    expect(
      constName({ k: "const", path: ["ActiveRecord", "RecordNotFound"] }),
    ).toBe("ActiveRecord::RecordNotFound");
    expect(constName({ k: "const", path: ["StandardError"] })).toBe("Error");
    expect(constName(call({ k: "const", path: ["JSON"] }, "parse"))).toBe(
      "JSON.parse",
    );
    expect(constName(null)).toBeNull();
  });

  it("folds a call through the idiom table and records the row", () => {
    expect(foldCall(call(lvar("s"), "strip"), "ruby")).toMatchObject({
      concept: "strip",
    });
    expect(foldCall(call(lvar("s"), "trim"), "ts")).toMatchObject({
      concept: "strip",
      idiom: "strip",
    });
    expect(foldCall(call(lvar("h"), "freeze"), "ruby")).toMatchObject({
      concept: null,
      idiom: "freeze",
    });
    expect(
      foldCall(
        call({ k: "const", path: ["JSON"] }, "stringify", [lvar("v")]),
        "ts",
      ),
    ).toMatchObject({ concept: "tojson" });
    expect(
      foldCall(call(lvar("m"), "get", [{ k: "str", value: "status" }]), "ts"),
    ).toMatchObject({ concept: "status", idiom: "hash-key" });
  });

  it("lowers TS into the Ruby IR's node kinds", () => {
    const ir = lowerTsFile(
      "x.ts",
      `class A extends B { static { this.hasMany("stories"); } async go(x) { if (x === null) throw new Err("no"); return await x?.y; } }`,
    );
    const cls = ir.body[0];
    expect(cls).toMatchObject({
      k: "class",
      path: ["A"],
      superclass: { k: "const", path: ["B"] },
    });
    const [decl, def] = cls.body.body;
    expect(decl).toMatchObject({
      k: "call",
      recv: { k: "self" },
      name: "hasMany",
      args: [{ k: "str", value: "stories" }],
    });
    expect(def).toMatchObject({ k: "def", name: "go", singleton: false });
    const [iff, ret] = def.body.body;
    expect(iff.then.body[0]).toMatchObject({
      k: "call",
      name: "raise",
      args: [
        { k: "const", path: ["Err"] },
        { k: "str", value: "no" },
      ],
    });
    expect(ret.value).toMatchObject({ k: "call", name: "y", safe: true });
  });

  it("extracts units: decls, consts, visibility and module_function", () => {
    const rubyModule: N = seq({
      k: "module",
      path: ["Ranking"],
      body: seq(
        { k: "casgn", path: ["UNSET"], value: { k: "int", value: "1" } },
        call(null, "module_function"),
        {
          k: "def",
          name: "rank",
          singleton: false,
          params: [{ kind: "req", name: "s" }],
          body: seq(),
        },
      ),
    });
    const [m] = extractUnits("ranking.rb", rubyModule, "ruby");
    expect(m).toMatchObject({ name: "Ranking", kind: "module" });
    expect([...m.consts.keys()]).toEqual(["UNSET"]);
    expect(m.methods[0]).toMatchObject({
      name: "rank",
      singleton: true,
      params: ["s"],
    });

    const ts = extractUnits(
      "rfc.ts",
      lowerTsFile(
        "rfc.ts",
        `export class Rfc extends ApplicationRecord { static { for (const c of ["a", "b"]) this.serialize(c); } private x() {} }`,
      ),
      "ts",
    );
    expect(ts[0].decls.map((d) => d.args[0].value)).toEqual(["a", "b"]);
    expect(ts[0].methods[0]).toMatchObject({ name: "x", private: true });
  });

  it("folds through the run's context, not module state", () => {
    const ctx: TwinContext = {
      enums: new Map([["closed", "status"]]),
      structs: new Set(["Row"]),
    };
    const newRow = call({ k: "const", path: ["Row"] }, "new", [lvar("x")]);
    expect(foldCall(newRow, "ruby")).toMatchObject({ concept: "new:Row" });
    expect(foldCall(newRow, "ruby", ctx)).toMatchObject({
      concept: null,
      idiom: "struct-inline",
    });
    const ts = tsBody(`export function f(s) { return s.status === "closed"; }`);
    expect(keys(ts, "ts")).not.toContain("call:closed");
    expect(features(ts, "ts", ctx).items.map((f) => f.key)).toContain(
      "call:closed",
    );
  });

  // The Ruby front-end needs Prism (Ruby 3.3+) and a Rails twin to read:
  // `rails/app` by default, or TWIN_DIFF_RAILS to point at another checkout of
  // the twin. CI's rails job has both; the unit job has no Ruby and skips.
  const railsApp =
    env.TWIN_DIFF_RAILS ?? getPath().join(Dir.pwd(), "rails/app");
  const runnable =
    getFs().existsSync(railsApp) &&
    getChildProcess().spawnSync("ruby", ["-e", 'require "prism"']).status === 0;

  it.skipIf(!runnable)(
    "runs end to end over rails/ and app/",
    () => {
      const { join } = getPath();
      const out = join(Dir.pwd(), "tmp", "twin-diff-test");
      const run = getChildProcess().spawnSync(
        "npx",
        [
          "tsx",
          "scripts/twin-diff/cli.ts",
          "--out",
          out,
          "--area",
          "models,views",
          "--rails",
          railsApp,
        ],
        {
          encoding: "utf8",
        },
      );
      expect(run.status).toBe(0);
      const report = JSON.parse(
        getFs().readFileSync(join(out, "twin-diff.json"), "utf8"),
      );
      const findings = report.pairs.flatMap(
        (p: { findings: { kind: string; detail: string }[] }) => p.findings,
      );
      expect(findings).toContainEqual(
        expect.objectContaining({
          kind: "unit-relocated",
          detail: expect.stringContaining("JsonArray"),
        }),
      );
      expect(
        report.pairs.some((p: { ruby: string }) =>
          p.ruby.startsWith("views/owners/show.html.erb"),
        ),
      ).toBe(true);
    },
    120_000,
  );
});
