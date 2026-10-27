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
import type { N } from "./ir.ts";
import { lowerTsFile } from "./ts-ir.ts";
import {
  canon,
  constName,
  extractUnits,
  type Decl,
  type Method,
  type Unit,
} from "./model.ts";
import { diffFeatures, features, type Feature } from "./features.ts";

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
const AREAS = opt("area", "models,controllers,helpers,serializers,jobs").split(
  ",",
);

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

const ruby = child.spawnSync(
  "ruby",
  [
    join(ROOT, "scripts/twin-diff/ruby-ir.rb"),
    join(ROOT, "rails/app"),
    ...rubyFiles,
  ],
  {
    encoding: "utf8",
  },
);
if (ruby.status !== 0) throw new Error(`ruby-ir.rb failed: ${ruby.stderr}`);
const rubyIr = JSON.parse(ruby.stdout) as { file: string; body: N }[];

const rubyUnits: Unit[] = rubyIr.flatMap((f) =>
  extractUnits(f.file, f.body, "ruby"),
);
const tsUnits: Unit[] = tsFiles.flatMap((f: string) => {
  const rel = f.slice(join(ROOT, "app").length + 1);
  return extractUnits(rel, lowerTsFile(rel, fs.readFileSync(f, "utf8")), "ts");
});

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
  tier: "surface" | "body" | "idiom" | "rename";
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

function declBlock(d: Decl): N | null {
  return (
    d.block ?? d.args.find((a) => a.k === "lambda" || a.k === "block") ?? null
  );
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
    if (ro !== to)
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

  // Constants.
  const tConsts = new Set([...t.consts.keys()].map(canon));
  for (const [name] of r.consts)
    if (!tConsts.has(canon(name)))
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
    const rp = m.params.map(canon).join(",");
    const tp = tm.params.map(canon).join(",");
    if (rp !== tp)
      report.findings.push({
        tier: "surface",
        kind: "params",
        ruby: loc(r, m.line),
        ts: loc(tUnit, tm.line),
        detail: `${m.name}(${m.params.join(", ")}) ≠ ${tm.name}(${tm.params.join(", ")})`,
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

// TS surface with no Ruby twin.
const extras: Finding[] = [];
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
const md: string[] = ["# Twin diff: rails/ vs app/", ""];
const counts = new Map<string, number>();
for (const p of pairs)
  for (const f of p.findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
for (const f of extras) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
const bodyCount = pairs.reduce((s, p) => s + p.methods.length, 0);
md.push(
  `Ruby units: ${rubyUnits.length}, TS units: ${tsUnits.length}. Methods with body deviations: ${bodyCount}.`,
  "",
);
md.push(
  "| finding | count |",
  "| --- | --- |",
  ...[...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
  "",
);
const fmt = (fs: Feature[]) =>
  fs.map((f) => `\`${f.key}\`@${f.line}`).join(", ");
for (const p of pairs) {
  if (!p.findings.length && !p.methods.length) continue;
  md.push(`## ${p.ruby} ↔ ${p.ts ?? "—"} (${p.how})`, "");
  for (const f of p.findings)
    md.push(
      `- **${f.kind}** ${f.detail}${f.ruby && f.kind !== "unit-missing" ? ` — ${f.ruby}` : ""}${f.ts ? ` / ${f.ts}` : ""}`,
    );
  for (const m of p.methods) {
    md.push(`- **body** \`${m.name}\` (${m.ruby} / ${m.ts})`);
    if (m.missing.length) md.push(`  - ruby only: ${fmt(m.missing)}`);
    if (m.extra.length) md.push(`  - ts only: ${fmt(m.extra)}`);
  }
  md.push("");
}
md.push(
  "## TS-only surface",
  "",
  ...extras.map((f) => `- **${f.kind}** ${f.detail} — ${f.ts}`),
);
fs.writeFileSync(join(OUT, "twin-diff.md"), md.join("\n") + "\n");
console.log(
  `twin-diff: ${pairs.length} pairs, ${bodyCount} bodies differ; ${[...counts].map(([k, v]) => `${k}=${v}`).join(" ")}`,
);
console.log(`wrote ${join(OUT, "twin-diff.md")}`);
