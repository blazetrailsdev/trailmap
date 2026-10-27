/**
 * Twin diff: where the Rails twin (`rails/`) and the trails site (`app/`)
 * disagree by more than a language decision.
 *
 * Two passes. The SURFACE pass pairs every Ruby class and module with its TS
 * counterpart and compares what each declares — superclass, class-body
 * declarations (`has_many`, `validate`, `before_action`), constants, methods.
 * The BODY pass then compares each paired method's calls, branches, raises and
 * literals, after both sides have been folded through `idioms.ts`.
 *
 *     tsx scripts/twin-diff/cli.ts [--out <dir>] [--area models,controllers,helpers]
 *
 * Writes `<out>/twin-diff.json` and `<out>/twin-diff.md`.
 */
import {
  argv as ARGV,
  Dir,
  getChildProcessAsync,
  getFs,
  getPath,
} from "@blazetrails/ruby-compat";
import type { N, Param } from "./ir.ts";
import { lowerTsFile } from "./ts-ir.ts";
import { markupFeatures, tseToTs, viewTwinPath } from "./views.ts";
import {
  canon,
  constName,
  extractUnits,
  type Decl,
  type Method,
  type Unit,
} from "./model.ts";
import { diffFeatures, features, type Feature } from "./features.ts";
import { ENUM_VALUES, STRUCTS } from "./idioms.ts";

const fs = getFs();
const { join } = getPath();
const child = await getChildProcessAsync();
const ROOT = Dir.pwd();
const argv = [...ARGV];
const opt = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const OUT = opt("out", join(ROOT, "tmp/twin-diff"));
const AREAS = opt(
  "area",
  "models,controllers,helpers,serializers,jobs,views",
).split(",");

function files(dir: string, ext: string): string[] {
  let out: string[] = [];
  if (!fs.existsSync(dir)) return [];
  for (const e of fs.readdirSync(dir)) {
    const p = join(dir, e);
    if (fs.statSync(p).isDirectory()) out = out.concat(files(p, ext));
    else if (p.endsWith(ext) && !p.endsWith(".test.ts") && !p.endsWith(".d.ts"))
      out.push(p);
  }
  return out;
}

const rubyFiles = AREAS.flatMap((a: string) =>
  files(join(ROOT, "rails/app", a), ".rb"),
);
const tsFiles = AREAS.flatMap((a: string) =>
  files(join(ROOT, "app", a), ".ts"),
);

const erbFiles = AREAS.includes("views")
  ? files(join(ROOT, "rails/app/views"), ".erb")
  : [];
const ruby = child.spawnSync(
  "ruby",
  [
    join(ROOT, "scripts/twin-diff/ruby-ir.rb"),
    join(ROOT, "rails/app"),
    ...rubyFiles,
    ...erbFiles,
  ],
  {
    encoding: "utf8",
  },
);
if (ruby.status !== 0) throw new Error(`ruby-ir.rb failed: ${ruby.stderr}`);
const rubyIrAll = JSON.parse(ruby.stdout) as { file: string; body: N }[];
const rubyIr = rubyIrAll.filter((f) => !f.file.endsWith(".erb"));
const erbIr = rubyIrAll.filter((f) => f.file.endsWith(".erb"));

const rubyUnits: Unit[] = rubyIr.flatMap((f) =>
  extractUnits(f.file, f.body, "ruby"),
);
const tsUnits: Unit[] = tsFiles.flatMap((f: string) => {
  const rel = f.slice(join(ROOT, "app").length + 1);
  return extractUnits(rel, lowerTsFile(rel, fs.readFileSync(f, "utf8")), "ts");
});

for (const u of rubyUnits)
  for (const d of u.decls.filter((d) => d.name === "enum")) {
    const attr = d.args[0]?.k === "sym" ? String(d.args[0].value) : null;
    const prefixed = d.args.some((a) =>
      (a.pairs ?? []).some((p: { key: N }) => p.key.value === "prefix"),
    );
    const values = evalDecl(d, u).args[1];
    const names: string[] =
      values?.k === "hash"
        ? values.pairs.map((p: { key: N }) => String(p.key.value))
        : values?.k === "array"
          ? values.elems.map((e: N) => String(e.value))
          : [];
    for (const v of names)
      ENUM_VALUES.set(
        prefixed && attr ? canon(attr + "_" + v) : canon(v),
        attr ?? "",
      );
  }
for (const u of rubyUnits)
  if (u.superclass === "Struct") STRUCTS.add(u.name.split("::").pop()!);

/** `models/concerns/dep_graph.rb` → `models/concerns/dep-graph.ts` */
const twinPath = (rb: string) => rb.replace(/_/g, "-").replace(/\.rb$/, ".ts");
const lastSeg = (name: string) => name.split(/::|\./).pop()!;

const tsByFile = new Map<string, Unit[]>();
for (const u of tsUnits)
  tsByFile.set(u.file, [...(tsByFile.get(u.file) ?? []), u]);
const tsByName = new Map<string, Unit[]>();
for (const u of tsUnits)
  if (u.kind !== "file")
    tsByName.set(canon(lastSeg(u.name)), [
      ...(tsByName.get(canon(lastSeg(u.name))) ?? []),
      u,
    ]);
const tsFnIndex = new Map<string, { unit: Unit; method: Method }[]>();
for (const u of tsUnits)
  for (const m of u.methods)
    tsFnIndex.set(canon(m.name), [
      ...(tsFnIndex.get(canon(m.name)) ?? []),
      { unit: u, method: m },
    ]);

type Finding = {
  tier: "surface" | "body" | "idiom" | "rename" | "framework";
  kind: string;
  ruby?: string;
  ts?: string;
  detail: string;
};

interface PairReport {
  ruby: string;
  ts: string | null;
  how: "same-file" | "file-module" | "relocated" | "unpaired";
  findings: Finding[];
  methods: MethodReport[];
}

interface MethodReport {
  name: string;
  ruby: string;
  ts: string | null;
  how: string;
  missing: Feature[];
  extra: Feature[];
  idioms: Record<string, number>;
  unhandled: number;
}

const usedTs = new Set<Unit>();
const usedTsMethods = new Set<Method>();
const pairs: PairReport[] = [];

function findTwin(r: Unit): { unit: Unit | null; how: PairReport["how"] } {
  const base = (f: string) => f.split("/").pop()!;
  let local = tsByFile.get(twinPath(r.file)) ?? [];
  // `models/concerns/rfc_close.rb` written as `models/rfc-close.ts`.
  if (!local.length)
    local = [...tsByFile]
      .filter(([f]) => base(f) === base(twinPath(r.file)))
      .flatMap(([, us]) => us);
  if (r.kind === "file") {
    const fileUnit = local.find((u) => u.kind === "file");
    return fileUnit
      ? { unit: fileUnit, how: "same-file" }
      : { unit: null, how: "unpaired" };
  }
  // A module of functions is the TS file's functions, even when the file also
  // exports an interface of the module's name.
  const structLike = (u: Unit) =>
    u.superclass === "Struct" && !u.methods.length;
  const eligible = (u: Unit) =>
    u.kind !== "file" &&
    !usedTs.has(u) &&
    !(r.kind === "module" && structLike(u));
  const byName = local.find(
    (u) => eligible(u) && canon(lastSeg(u.name)) === canon(lastSeg(r.name)),
  );
  if (byName) return { unit: byName, how: "same-file" };
  if (r.kind === "module") {
    const fileUnit = local.find((u) => u.kind === "file" && !usedTs.has(u));
    if (fileUnit) return { unit: fileUnit, how: "file-module" };
  }
  // `Ranking::Index` written as `RankingIndex` beside the module's functions.
  const qualified = local.find(
    (u) => eligible(u) && canon(u.name) === canon(r.name.replace(/::/g, "")),
  );
  if (qualified) return { unit: qualified, how: "same-file" };
  const elsewhere = r.name.includes("::")
    ? []
    : (tsByName.get(canon(lastSeg(r.name))) ?? []).filter(eligible);
  if (elsewhere.length) return { unit: elsewhere[0], how: "relocated" };
  return { unit: null, how: "unpaired" };
}

const loc = (u: Unit, line: number) => `${u.file}:${line}`;

function render(n: N | null | undefined): string {
  if (!n) return "nil";
  switch (n.k) {
    case "sym":
    case "str":
      return JSON.stringify(
        /^[a-z][A-Za-z0-9_]*$/.test(String(n.value))
          ? canon(String(n.value))
          : n.value,
      );
    case "int":
    case "float":
      return String(n.value);
    case "true":
    case "false":
    case "nil":
    case "self":
      return n.k;
    case "const":
      return lastSeg(constName(n)!);
    case "array":
      return `[${(n.elems as N[]).map(render).join(", ")}]`;
    case "hash":
    case "kwargs":
      return `{${(n.pairs as { key: N; value: N }[])
        .map(
          (p) =>
            `${p.key.k === "sym" || p.key.k === "str" ? canon(String(p.key.value)) : render(p.key)}: ${render(p.value)}`,
        )
        .sort()
        .join(", ")}}`;
    case "dregex":
    case "regex":
      return "regex";
    case "call":
      if (n.name === "new" && constName(n.recv) === "RegExp") return "regex";
      return `${n.recv ? render(n.recv) + "." : ""}${canon(n.name)}${n.args?.length ? `(${(n.args as N[]).map(render).join(", ")})` : ""}`;
    case "lambda":
    case "block":
      return "→fn";
    case "symproc":
      return `&:${n.name}`;
    case "lvar":
      // `beforeAction(requireLoopback)` passes the function; Ruby passes its name.
      return JSON.stringify(canon(n.name));
    default:
      return n.k;
  }
}

/** A decl's identity: `has_many :stories` and `this.hasMany("stories")` both key as `hasmany "stories"`. */
function declKey(d: Decl): string {
  const first = d.args.find(
    (a) =>
      a.k !== "kwargs" && a.k !== "hash" && a.k !== "lambda" && a.k !== "block",
  );
  return `${canon(d.name)} ${first ? render(first) : ""}`.trim();
}

function declOpts(d: Decl): string {
  const rest = d.args.filter((a) => a.k !== "lambda" && a.k !== "block");
  return (
    rest.slice(1).map(render).join(", ") +
    (d.block || d.args.some((a) => a.k === "lambda" || a.k === "block")
      ? " &block"
      : "")
  );
}

/**
 * Fold the constant expressions a Rails class body builds a macro's argument
 * from, so `enum :status, STATUSES.index_by(&:itself)` meets the literal hash
 * TS writes: a constant of the unit, and `index_by(&:itself)` over an array.
 */
function evalDecl(d: Decl, u: Unit): Decl {
  const ev = (n: N): N => {
    if (n?.k === "const" && u.consts.has((n.path as string[]).join("::")))
      return ev(u.consts.get((n.path as string[]).join("::"))!);
    if (n?.k === "call" && (n.name === "freeze" || n.name === "dup") && n.recv)
      return ev(n.recv);
    if (
      n?.k === "call" &&
      (n.name === "index_by" || n.name === "index_with") &&
      n.block?.k === "symproc" &&
      n.block.name === "itself"
    ) {
      const arr = ev(n.recv);
      if (arr.k === "array")
        return {
          k: "hash",
          pairs: (arr.elems as N[]).map((e) => ({ key: e, value: e })),
        };
    }
    return n;
  };
  return { ...d, args: d.args.map(ev) };
}

const ASSOCIATIONS = new Set([
  "belongsto",
  "hasmany",
  "hasone",
  "hasandbelongstomany",
]);

function declBlock(d: Decl): N | null {
  return (
    d.block ?? d.args.find((a) => a.k === "lambda" || a.k === "block") ?? null
  );
}

/** A body difference below this is builtin spelling the idiom table has not learned yet. */
const BODY_THRESHOLD = 3;

/** JS/Ruby library calls: a difference in these is usually spelling, in a domain call usually behaviour. */
const BUILTIN = new Set(
  "[] << each map select reject find any all length inject sort uniq first last flatmap keys values eachpair toh groupby isa tonumber round max strip downcase upcase startwith endwith sub match format jsonparse tojson include newset index indexof join split compact flatten zip eachslice eachwithobject eachwithindex count call not positive negative zero nonzero tally sum filtermap selectmap todate iso8601 toisostring utc days now parse new:Date getfullyear gettime abs delete deleteprefix deletesuffix chars bytes reverse concat merge update slice entries from array integer float key".split(
    " ",
  ),
);

function score(m: MethodReport): number {
  let s = 0;
  for (const f of [...m.missing, ...m.extra]) {
    const [kind, rest] = [
      f.key.slice(0, f.key.indexOf(":") >>> 0 || f.key.length),
      f.key.slice(f.key.indexOf(":") + 1),
    ];
    if (kind === "raise") s += 3;
    else if (kind === "call") s += BUILTIN.has(rest) ? 0.5 : 2;
    else if (kind === "lit") s += /\s/.test(rest) ? 2 : 1;
    else if (kind === "text" || kind === "render") s += 2;
    else if (kind === "html" || kind === "local") s += 1;
    else if (kind === "ivar") s += 1;
    else if (f.key === "branch:guard") s += 0.25;
    else if (kind === "branch" || kind === "rescue" || kind === "loop") s += 1;
    else s += 0.5;
  }
  return s;
}

function bodyReport(
  name: string,
  rubyLoc: string,
  tsLoc: string | null,
  how: string,
  rb: N,
  tsb: N,
): MethodReport {
  const rf = features(rb, "ruby");
  const tf = features(tsb, "ts");
  // A Rails partial reads its parent's ivars; TS hands them over as locals. When
  // the Ruby body passes no locals at all, the TS ones are that decision.
  if (!rf.items.some((f) => f.key.startsWith("local:")))
    tf.items = tf.items.filter((f) => !f.key.startsWith("local:"));
  const d = diffFeatures(rf.items, tf.items);
  const idioms: Record<string, number> = {};
  for (const [k, v] of [...rf.idioms, ...tf.idioms])
    idioms[k] = (idioms[k] ?? 0) + v;
  return {
    name,
    ruby: rubyLoc,
    ts: tsLoc,
    how,
    missing: d.missing,
    extra: d.extra,
    idioms,
    unhandled: rf.unhandled + tf.unhandled,
  };
}

for (const r of rubyUnits) {
  const { unit: twin, how } = findTwin(r);
  const report: PairReport = {
    ruby: loc(r, r.line),
    ts: twin ? loc(twin, twin.line) : null,
    how,
    findings: [],
    methods: [],
  };
  pairs.push(report);
  if (!twin && r.superclass === "Struct") {
    // TS writes a Ruby value Struct as an inline object literal or an anonymous type.
    report.findings.push({
      tier: "idiom",
      kind: "struct-inline",
      ruby: loc(r, r.line),
      detail: `${r.name}(${(r.members ?? []).join(", ")})`,
    });
    continue;
  }
  if (!twin) {
    report.findings.push({
      tier: "surface",
      kind: "unit-missing",
      ruby: loc(r, r.line),
      detail: `${r.kind} ${r.name} has no TS counterpart`,
    });
    continue;
  }
  const t: Unit = twin;
  usedTs.add(t);
  if (how === "relocated")
    report.findings.push({
      tier: "surface",
      kind: "unit-relocated",
      ruby: loc(r, r.line),
      ts: loc(t, t.line),
      detail: `${r.name} lives in ${t.file}, not ${twinPath(r.file)}`,
    });
  const rSup = r.superclass ? lastSeg(r.superclass) : null;
  const tSup = t.superclass ? lastSeg(t.superclass) : null;
  if (
    t.kind !== "file" &&
    rSup !== tSup &&
    !(rSup === "Struct" && tSup === null)
  )
    report.findings.push({
      tier: "surface",
      kind: "superclass",
      ruby: loc(r, r.line),
      ts: loc(t, t.line),
      detail: `${rSup ?? "(none)"} ≠ ${tSup ?? "(none)"}`,
    });

  if (r.members || t.members) {
    const rm = new Set((r.members ?? []).map(canon));
    const tm = new Set((t.members ?? []).map(canon));
    const missing = [...(r.members ?? [])].filter((m) => !tm.has(canon(m)));
    const extra = [...(t.members ?? [])].filter((m) => !rm.has(canon(m)));
    if (missing.length || extra.length)
      report.findings.push({
        tier: "surface",
        kind: "struct-members",
        ruby: loc(r, r.line),
        ts: loc(t, t.line),
        detail: `ruby only: [${missing.join(", ")}]; ts only: [${extra.join(", ")}]`,
      });
  }

  // Declarations.
  const tDecls = new Map<string, Decl[]>();
  for (const d of t.decls)
    tDecls.set(declKey(d), [...(tDecls.get(declKey(d)) ?? []), d]);
  const unmatched: Decl[] = [];
  for (const d of r.decls) {
    const match = tDecls.get(declKey(evalDecl(d, r)))?.shift();
    if (!match) {
      unmatched.push(d);
      continue;
    }
    compareDecl(d, match);
  }
  // Same macro, different first argument: `after_save :close_rfc_if_complete`
  // against an inline `afterSave((s) => …)`.
  for (const d of unmatched) {
    const sameName = [...tDecls.entries()].find(
      ([k, v]) => v.length && k.split(" ")[0] === canon(d.name),
    );
    const match = sameName?.[1].shift();
    if (!match) {
      report.findings.push({
        tier: "surface",
        kind: "decl-missing",
        ruby: loc(r, d.line),
        detail:
          `${d.name} ${d.args.map(render).join(", ")}${d.block ? " &block" : ""}`.trim(),
      });
      continue;
    }
    report.findings.push({
      tier: "surface",
      kind: "decl-shape",
      ruby: loc(r, d.line),
      ts: loc(t, match.line),
      detail: `${d.name}: ruby (${d.args.map(render).join(", ")}${d.block ? " &block" : ""}) ≠ ts (${match.args.map(render).join(", ")}${match.block ? " &block" : ""})`,
    });
    const rb = declBlock(d);
    const tb = declBlock(match);
    if (rb && tb) {
      const m = bodyReport(
        `${declKey(d)} &block`,
        loc(r, d.line),
        loc(t, match.line),
        "decl-block",
        rb,
        tb,
      );
      if (m.missing.length || m.extra.length) report.methods.push(m);
    }
  }
  function compareDecl(d: Decl, match: Decl) {
    const key = declKey(d);
    const ro = declOpts(evalDecl(d, r));
    const to = declOpts(match);
    // TS spelling out an association option Rails infers (`foreign_key:
    // "owner_id"`, `class_name: "Owner"`) points at trails' inference, not the app.
    const optKeys = (x: Decl) =>
      new Map(
        x.args
          .filter((a) => a.k === "kwargs" || a.k === "hash")
          .flatMap((a) => a.pairs as { key: N; value: N }[])
          .map((p) => [canon(String(p.key.value)), render(p.value)] as const),
      );
    const rk = optKeys(evalDecl(d, r));
    const tk = optKeys(match);
    const onlyInferable =
      ASSOCIATIONS.has(canon(d.name)) &&
      [...rk].every(([k, v]) => tk.get(k) === v) &&
      [...tk.keys()]
        .filter((k) => !rk.has(k))
        .every((k) => k === "foreignkey" || k === "classname");
    if (ro !== to && onlyInferable)
      report.findings.push({
        tier: "framework",
        kind: "explicit-inferable-option",
        ruby: loc(r, d.line),
        ts: loc(t, match.line),
        detail: `${key}: ts adds (${[...tk]
          .filter(([k]) => !rk.has(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")})`,
      });
    else if (ro !== to)
      report.findings.push({
        tier: "surface",
        kind: "decl-options",
        ruby: loc(r, d.line),
        ts: loc(t, match.line),
        detail: `${key}: ruby (${ro}) ≠ ts (${to})`,
      });
    const rb = declBlock(d);
    const tb = declBlock(match);
    if (rb && tb) {
      const m = bodyReport(
        `${key} &block`,
        loc(r, d.line),
        loc(t, match.line),
        "decl-block",
        rb,
        tb,
      );
      if (m.missing.length || m.extra.length) report.methods.push(m);
    }
  }
  // `static tab = "code"` is Ruby's `class_attribute :tab, default: "code"`: a member, not a stray decl.
  const rMembers = new Set(
    r.methods.filter((m) => m.declared).map((m) => canon(m.name)),
  );
  for (const [key, rest] of tDecls)
    for (const d of rest.filter(
      (d) => !(d.name.endsWith("=") && rMembers.has(canon(d.name))),
    ))
      report.findings.push({
        tier: "surface",
        kind: "decl-extra",
        ts: loc(t, d.line),
        detail: `${key} ${declOpts(d)}`.trim(),
      });

  // Constants. A class constant is often a module-level `const` in TS, and
  // prefixed with the class's name there (`Rfc::STATUSES` is `RFC_STATUSES`).
  const tConsts = [...new Set([t, ...(tsByFile.get(t.file) ?? [])])].flatMap(
    (u) => [...u.consts.keys()].map(canon),
  );
  for (const [name] of r.consts)
    if (!tConsts.some((c) => c === canon(name) || c.endsWith(canon(name))))
      report.findings.push({
        tier: "surface",
        kind: "const-missing",
        ruby: loc(r, r.line),
        detail: name,
      });

  // Methods.
  const tMethods = t.methods.filter((m) => !usedTsMethods.has(m));
  const unpairedMethods: Method[] = [];
  for (const m of r.methods) {
    let tm = tMethods.find(
      (x) =>
        canon(x.name) === canon(m.name) &&
        x.singleton === m.singleton &&
        !usedTsMethods.has(x),
    );
    let mhow = "same-unit";
    if (!tm) {
      tm = tMethods.find(
        (x) => canon(x.name) === canon(m.name) && !usedTsMethods.has(x),
      );
      if (tm) {
        mhow = "kind-changed";
        report.findings.push({
          tier: "surface",
          kind: "method-kind",
          ruby: loc(r, m.line),
          ts: loc(t, tm.line),
          detail: `${m.name}: ${m.singleton ? "class" : "instance"} method in Ruby, ${tm.singleton ? "static" : "instance"} in TS`,
        });
      }
    }
    let tUnit = t;
    if (!tm) {
      // Only a module function moves to another file's top level, and only an
      // unambiguous name is trusted to have moved rather than collided.
      const cands = (tsFnIndex.get(canon(m.name)) ?? []).filter(
        (x) =>
          !usedTsMethods.has(x.method) &&
          !x.method.declared &&
          x.unit.kind === "file",
      );
      const far =
        (r.kind === "module" || m.singleton) && cands.length === 1
          ? cands[0]
          : undefined;
      if (far) {
        tm = far.method;
        tUnit = far.unit;
        mhow = "relocated";
        report.findings.push({
          tier: "surface",
          kind: "method-relocated",
          ruby: loc(r, m.line),
          ts: loc(far.unit, far.method.line),
          detail: `${m.name} → ${far.unit.kind === "file" ? far.unit.file : far.unit.name}#${far.method.name}`,
        });
      }
    }
    if (!tm) {
      unpairedMethods.push(m);
      continue;
    }
    compareMethod(m, tm, tUnit, mhow);
  }

  // Renamed: `Backlog.order` written as `orderBacklog`, `DepGraph.for` as
  // `depGraphFor`. Scored on name words (less the module's own) and on how
  // much of the body's calls and literals the two share.
  const pool = [...new Set([t, ...(tsByFile.get(t.file) ?? [])])].flatMap((u) =>
    u.methods
      .filter((x) => !usedTsMethods.has(x) && !x.declared)
      .map((x) => ({ unit: u, method: x })),
  );
  const scored: {
    m: Method;
    c: { unit: Unit; method: Method };
    score: number;
  }[] = [];
  for (const m of unpairedMethods)
    for (const c of pool) {
      const score =
        0.6 * nameSimilarity(m.name, c.method.name, r.name) +
        0.4 * bodySimilarity(m.body, c.method.body);
      if (score >= 0.45) scored.push({ m, c, score });
    }
  scored.sort((a, b) => b.score - a.score);
  const renamed = new Set<Method>();
  for (const { m, c, score } of scored) {
    if (renamed.has(m) || usedTsMethods.has(c.method)) continue;
    renamed.add(m);
    const same = canon(m.name) === canon(c.method.name);
    report.findings.push({
      tier: same ? "surface" : "rename",
      kind: same ? "method-relocated" : "method-renamed",
      ruby: loc(r, m.line),
      ts: loc(c.unit, c.method.line),
      detail: same
        ? `${m.name} → ${c.unit.kind === "file" ? c.unit.file : c.unit.name}#${c.method.name}`
        : `${m.name} → ${c.method.name} (${score.toFixed(2)})`,
    });
    compareMethod(m, c.method, c.unit, "renamed");
  }
  for (const m of unpairedMethods)
    if (!renamed.has(m) && /^js_/.test(m.name))
      // `js_round`, `js_number`: the twin's spelling of a JS number rule, which TS gets from the language.
      report.findings.push({
        tier: "idiom",
        kind: "ruby-shim",
        ruby: loc(r, m.line),
        detail: m.name,
      });
    else if (!renamed.has(m))
      report.findings.push({
        tier: "surface",
        kind: "method-missing",
        ruby: loc(r, m.line),
        detail: `${m.singleton ? "self." : ""}${m.name}(${m.params.join(", ")})`,
      });

  function compareMethod(m: Method, tm: Method, tUnit: Unit, mhow: string) {
    usedTsMethods.add(tm);
    if (tm.declared) return;
    if (m.private !== tm.private && tUnit.kind !== "file")
      report.findings.push({
        tier: "surface",
        kind: "visibility",
        ruby: loc(r, m.line),
        ts: loc(tUnit, tm.line),
        detail: `${m.name}: ${m.private ? "private" : "public"} in Ruby, ${tm.private ? "private" : "public"} in TS`,
      });
    // An instance method written as a free function takes its receiver first:
    // `require_loopback` is `requireLoopback(controller)`.
    const receiverParam =
      tUnit.kind === "file" &&
      !m.singleton &&
      (tm.paramList?.length ?? 0) === (m.paramList?.length ?? 0) + 1;
    const pd = compareParams(
      m.paramList ?? [],
      receiverParam ? (tm.paramList ?? []).slice(1) : (tm.paramList ?? []),
    );
    if (receiverParam)
      report.findings.push({
        tier: "idiom",
        kind: "receiver-param",
        ruby: loc(r, m.line),
        ts: loc(tUnit, tm.line),
        detail: `${m.name} → ${tm.name}(${tm.paramList?.[0]?.name}, …)`,
      });
    if (pd)
      report.findings.push({
        tier: pd.arity ? "surface" : "rename",
        kind: pd.arity ? "params" : "param-names",
        ruby: loc(r, m.line),
        ts: loc(tUnit, tm.line),
        detail: `${m.name}(${(m.paramList ?? []).map(showParam).join(", ")}) ≠ ${tm.name}(${(tm.paramList ?? []).map(showParam).join(", ")})${pd.note ? ` — ${pd.note}` : ""}`,
      });
    const mr = bodyReport(
      m.name,
      loc(r, m.line),
      loc(tUnit, tm.line),
      mhow,
      m.body,
      tm.body,
    );
    if (mr.missing.length || mr.extra.length) report.methods.push(mr);
  }
}

function showParam(p: Param): string {
  if (p.destructure) return `{ ${p.destructure.join(", ")} }`;
  const name = p.name ?? "_";
  return (
    {
      rest: `*${name}`,
      key: `${name}:`,
      keyreq: `${name}:`,
      keyrest: `**${name}`,
      block: `&${name}`,
      opt: `${name}=`,
      req: name,
      fwd: "...",
    }[p.kind] ?? name
  );
}

/**
 * Ruby kwargs are one trailing options object in TS, and a block is a
 * trailing function parameter; both are language decisions. What is left is
 * a different positional arity (a deviation) or different names (a rename).
 */
function compareParams(
  rp: Param[],
  tp: Param[],
): { arity: boolean; note?: string } | null {
  const rPos = rp.filter(
    (p) => p.kind === "req" || p.kind === "opt" || p.kind === "rest",
  );
  const rKw = rp.filter(
    (p) => p.kind === "key" || p.kind === "keyreq" || p.kind === "keyrest",
  );
  const rBlock = rp.find((p) => p.kind === "block");
  const tPos = [...tp];
  let note = "";
  if (rKw.length && tPos.length > rPos.length) {
    const opts = tPos.pop()!;
    if (opts.destructure) {
      const want = rKw
        .filter((p) => p.kind !== "keyrest")
        .map((p) => canon(p.name ?? ""));
      const have = opts.destructure.map((n) => canon(n ?? ""));
      const missing = want.filter((w) => !have.includes(w));
      const extra = have.filter((h) => !want.includes(h));
      if (missing.length || extra.length)
        note =
          `kwargs ${missing.length ? `ruby only [${missing}]` : ""}${extra.length ? ` ts only [${extra}]` : ""}`.trim();
    }
  }
  if (rBlock && tPos.length > rPos.length) tPos.pop();
  if (
    rPos.length !== tPos.length ||
    (rKw.length > 0 &&
      !note &&
      tp.length === rPos.length &&
      rPos.length === tPos.length &&
      false)
  )
    return { arity: true, note: note || undefined };
  if (note) return { arity: true, note };
  const names = rPos.some(
    (p, i) => canon(p.name ?? "") !== canon(tPos[i]?.name ?? ""),
  );
  return names ? { arity: false } : null;
}

function words(name: string): string[] {
  return name
    .replace(/[?!=]$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split("_")
    .filter((w) => w && w !== "is");
}

function nameSimilarity(ruby: string, ts: string, unitName: string): number {
  const own = new Set(words(lastSeg(unitName)));
  const a = words(ruby);
  const b = words(ts).filter((w) => !own.has(w) || a.includes(w));
  if (!a.length || !b.length) return 0;
  const inter = a.filter((w) => b.includes(w)).length;
  return inter / new Set([...a, ...b]).size;
}

function bodySimilarity(rb: N, tb: N): number {
  const a = features(rb, "ruby").items.map((f) => f.key);
  const b = features(tb, "ts").items.map((f) => f.key);
  if (!a.length && !b.length) return 0;
  const d = diffFeatures(
    a.map((key) => ({ key, line: 0 })),
    b.map((key) => ({ key, line: 0 })),
  );
  return (a.length - d.missing.length) / Math.max(a.length, b.length);
}

// Templates: code through the body diff, markup beside it.
const viewsSeen = new Set<string>();
for (const v of erbIr) {
  const tsRel = viewTwinPath(v.file);
  const tsPath = join(ROOT, "app", tsRel);
  const report: PairReport = {
    ruby: `${v.file}:1`,
    ts: null,
    how: "unpaired",
    findings: [],
    methods: [],
  };
  pairs.push(report);
  if (!fs.existsSync(tsPath)) {
    report.findings.push({
      tier: "surface",
      kind: "view-missing",
      ruby: `${v.file}:1`,
      detail: `no ${tsRel}`,
    });
    continue;
  }
  viewsSeen.add(tsRel);
  report.ts = `${tsRel}:1`;
  report.how = "same-file";
  const tse = fs.readFileSync(tsPath, "utf8");
  const tsBody = lowerTsFile(tsRel, tseToTs(tse)).body[0]?.body ?? {
    k: "seq",
    body: [],
  };
  const rbBody = (v.body.body as N[])[0]?.body ?? { k: "seq", body: [] };
  const m = bodyReport(
    "(template)",
    `${v.file}:1`,
    `${tsRel}:1`,
    "view",
    rbBody,
    tsBody,
  );
  const markup = diffFeatures(
    markupFeatures(fs.readFileSync(join(ROOT, "rails/app", v.file), "utf8")),
    markupFeatures(tse),
  );
  m.missing.push(...markup.missing);
  m.extra.push(...markup.extra);
  if (m.missing.length || m.extra.length) report.methods.push(m);
}

// TS surface with no Ruby twin.
const extras: Finding[] = [];
if (AREAS.includes("views"))
  for (const f of files(join(ROOT, "app/views"), ".tse")) {
    const rel = f.slice(join(ROOT, "app").length + 1);
    if (!viewsSeen.has(rel))
      extras.push({
        tier: "surface",
        kind: "ts-only-view",
        ts: `${rel}:1`,
        detail: rel,
      });
  }
for (const u of tsUnits) {
  if (!usedTs.has(u)) {
    if (u.kind === "file") {
      for (const m of u.methods)
        if (!usedTsMethods.has(m) && !m.private)
          extras.push({
            tier: "surface",
            kind: "ts-only-function",
            ts: loc(u, m.line),
            detail: m.name,
          });
    } else if (u.superclass === "Struct" && !u.methods.length)
      extras.push({
        tier: "idiom",
        kind: "ts-only-type",
        ts: loc(u, u.line),
        detail: u.name,
      });
    else
      extras.push({
        tier: "surface",
        kind: "ts-only-unit",
        ts: loc(u, u.line),
        detail: `${u.kind} ${u.name}`,
      });
    continue;
  }
  for (const m of u.methods)
    if (!usedTsMethods.has(m) && !m.declared && !m.private)
      extras.push({
        tier: "surface",
        kind: "ts-only-method",
        ts: loc(u, m.line),
        detail: `${u.kind === "file" ? u.file : u.name}#${m.name}`,
      });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  join(OUT, "twin-diff.json"),
  JSON.stringify({ pairs, extras }, null, 1),
);

// Markdown.
const allFindings = [...pairs.flatMap((p) => p.findings), ...extras];
const bodies = pairs.flatMap((p) =>
  p.methods.map((m) => ({ ...m, score: score(m) })),
);
bodies.sort((a, b) => b.score - a.score);
const md: string[] = ["# Twin diff: rails/ vs app/", ""];
md.push(
  `Ruby units ${rubyUnits.length}, TS units ${tsUnits.length}; ${bodies.length} paired bodies differ, ` +
    `${bodies.filter((b) => b.score >= BODY_THRESHOLD).length} by more than builtin spelling (score ≥ ${BODY_THRESHOLD}).`,
  "",
  "| tier | finding | count |",
  "| --- | --- | --- |",
);
const counts = new Map<string, number>();
for (const f of allFindings)
  counts.set(
    `${f.tier}|${f.kind}`,
    (counts.get(`${f.tier}|${f.kind}`) ?? 0) + 1,
  );
for (const [k, v] of [...counts].sort())
  md.push(`| ${k.replace("|", " | ")} | ${v} |`);
md.push("");

const where = (f: Finding) => [f.ruby, f.ts].filter(Boolean).join(" ↔ ");
const section = (title: string, fs: Finding[]) => {
  if (!fs.length) return;
  md.push(`## ${title}`, "");
  const byKind = new Map<string, Finding[]>();
  for (const f of fs) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  for (const [kind, list] of byKind) {
    md.push(`### ${kind} (${list.length})`, "");
    for (const f of list) md.push(`- ${f.detail} — ${where(f)}`);
    md.push("");
  }
};
section(
  "Surface deviations",
  allFindings.filter((f) => f.tier === "surface"),
);

md.push(
  "## Body deviations",
  "",
  `Ranked by score: domain calls, raises and literals weigh most; builtin calls and bare numbers least.`,
  "",
);
const fmt = (fs: Feature[]) =>
  fs.map((f) => `\`${f.key}\`@${f.line}`).join(", ");
for (const b of bodies.filter((b) => b.score >= BODY_THRESHOLD)) {
  md.push(
    `- **${b.name}** (${b.score.toFixed(1)}) ${b.ruby} ↔ ${b.ts}${b.how !== "same-unit" ? ` _${b.how}_` : ""}`,
  );
  if (b.missing.length) md.push(`  - ruby only: ${fmt(b.missing)}`);
  if (b.extra.length) md.push(`  - ts only: ${fmt(b.extra)}`);
}
md.push("");
section(
  "Trails framework candidates (the TS works around something Rails infers)",
  allFindings.filter((f) => f.tier === "framework"),
);
section(
  "Renames (paired by name words and body overlap)",
  allFindings.filter((f) => f.tier === "rename"),
);

md.push(
  "## Language decisions applied",
  "",
  "Folds the body diff made, by idiom row (`idioms.ts`), summed over every paired body:",
  "",
);
const idiomTotals = new Map<string, number>();
for (const b of pairs.flatMap((p) => p.methods))
  for (const [k, v] of Object.entries(b.idioms))
    idiomTotals.set(k, (idiomTotals.get(k) ?? 0) + v);
md.push(
  [...idiomTotals]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `\`${k}\` ${v}`)
    .join(", "),
  "",
);
section(
  "Idiom-tier findings (not deviations)",
  allFindings.filter((f) => f.tier === "idiom"),
);
md.push("## Low-score body differences", "");
for (const b of bodies.filter((b) => b.score < BODY_THRESHOLD))
  md.push(
    `- ${b.name} (${b.score.toFixed(1)}) ${b.ruby} ↔ ${b.ts}: ruby only ${fmt(b.missing) || "—"}; ts only ${fmt(b.extra) || "—"}`,
  );
fs.writeFileSync(join(OUT, "twin-diff.md"), md.join("\n") + "\n");
console.log(
  `twin-diff: ${pairs.length} pairs; ${bodies.filter((b) => b.score >= BODY_THRESHOLD).length}/${bodies.length} bodies over threshold; ` +
    [...counts].map(([k, v]) => `${k.split("|")[1]}=${v}`).join(" "),
);
console.log(`wrote ${join(OUT, "twin-diff.md")}`);
