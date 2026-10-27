/**
 * A method body reduced to the facts a deviation shows up in: which calls it
 * makes, which branches it takes, which errors it raises and which literal
 * values it names. Both sides are reduced the same way, through the idiom
 * table, so a difference that survives is a difference in what the code does
 * rather than in how each language spells it.
 */
import type { N } from "./ir.ts";
import { canon, constName } from "./model.ts";
import { foldCall, STATUS_SYMBOLS, type Side } from "./idioms.ts";

const isLengthRead = (n: N | undefined) =>
  n?.k === "call" &&
  (n.name === "length" || n.name === "size") &&
  !n.args?.length;

/**
 * `render "shared/status_badge", status: s` and
 * `render({ partial: "shared/status-badge", locals: { status: s } })` render
 * one partial with one local.
 */
function renderPartial(
  node: N,
  side: Side,
): { name: string; locals: { key: N; value: N }[] } | null {
  if (node.name !== "render" || (node.recv && node.recv.k !== "self"))
    return null;
  const args: N[] = node.args ?? [];
  const pairsOf = (h: N | undefined): { key: N; value: N }[] =>
    h && (h.k === "hash" || h.k === "kwargs") ? h.pairs : [];
  const partialName = (s: string) => s.replace(/[-_]/g, "").toLowerCase();
  if (side === "ruby" && args[0]?.k === "str")
    return { name: partialName(args[0].value), locals: pairsOf(args[1]) };
  const opts = pairsOf(args[0]);
  const partial = opts.find((p) => p.key.value === "partial");
  if (partial?.value.k === "str") {
    const locals = opts.find((p) => p.key.value === "locals");
    return {
      name: partialName(partial.value.value),
      locals: pairsOf(locals?.value),
    };
  }
  return null;
}

interface Pattern {
  concept: string | null;
  idiom?: string;
  ivars?: string[];
  visit: unknown[];
}

/**
 * Whole-statement JS spellings of one Ruby call, recognised before the
 * per-call fold: a loop that filters into an array is `select`, one that only
 * pushes is `map`, `xs.length > 0` is `any?`, and a controller's explicit
 * `render({ locals })` is Rails' implicit render of the action's ivars.
 */
function tsPattern(node: N): Pattern | null {
  const COMPARE = new Set(["==", ">", ">=", "<", "<="]);
  // `n > 0` is Ruby's `n.positive?`, `n === 0` its `n.zero?`.
  if (
    COMPARE.has(node.name) &&
    node.args?.[0]?.k === "int" &&
    Number(node.args[0].value) === 0
  )
    return { concept: null, idiom: "sign", visit: [node.recv] };
  if (
    COMPARE.has(node.name) &&
    isLengthRead(node.recv) &&
    node.args?.[0]?.k === "int" &&
    Number(node.args[0].value) <= 1
  )
    return { concept: null, idiom: "empty-check", visit: [node.recv.recv] };
  if (node.name === "each" && node.block) {
    const stmts: N[] = node.block.body?.body ?? [];
    const isPush = (s: N | undefined) =>
      s?.k === "call" &&
      (s.name === "push" || s.name === "add") &&
      s.args?.length === 1;
    if (stmts.length === 1 && stmts[0].k === "if" && !stmts[0].else) {
      const inner: N[] = stmts[0].then?.body ?? [stmts[0].then];
      if (inner.length === 1 && isPush(inner[0]))
        return {
          concept: "select",
          idiom: "loop-select",
          visit: [node.recv, stmts[0].cond, inner[0].args],
        };
    }
    if (stmts.length === 1 && isPush(stmts[0]))
      return {
        concept: "map",
        idiom: "loop-map",
        visit: [node.recv, stmts[0].args],
      };
  }
  if (
    node.name === "render" &&
    (node.recv === null || node.recv?.k === "self")
  ) {
    const opts: N | undefined = node.args?.find(
      (a: N) => a.k === "kwargs" || a.k === "hash",
    );
    const pairs: { key: N; value: N }[] = opts?.pairs ?? [];
    const locals = pairs.find((p) => p.key.value === "locals");
    if (locals) {
      const rest = pairs.filter((p) => p !== locals);
      const localPairs: { key: N; value: N }[] = locals.value.pairs ?? [];
      return {
        concept: rest.length ? "render" : null,
        idiom: "explicit-render",
        ivars: localPairs.map((p) => String(p.key.value)),
        visit: [
          localPairs.map((p) => p.value),
          rest.map((p) => p.value),
          node.args.filter((a: N) => a !== opts),
        ],
      };
    }
  }
  return null;
}

export interface Feature {
  key: string;
  line: number;
}

export interface Features {
  items: Feature[];
  idioms: Map<string, number>;
  unhandled: number;
}

export function features(body: N, side: Side): Features {
  const items: Feature[] = [];
  const idioms = new Map<string, number>();
  let unhandled = 0;
  let lastLine = 0;
  const add = (key: string) => items.push({ key, line: lastLine });

  function visit(n: unknown): void {
    if (Array.isArray(n)) {
      for (const c of n) visit(c);
      return;
    }
    if (n === null || typeof n !== "object") return;
    const node = n as N;
    if (typeof node.l === "number") lastLine = node.l;
    switch (node.k) {
      case "call": {
        if (node.name === "__out" && !node.recv) {
          visit(node.args);
          return;
        }
        const partial = renderPartial(node, side);
        if (partial) {
          idioms.set("render-partial", (idioms.get("render-partial") ?? 0) + 1);
          add(`render:${partial.name}`);
          for (const p of partial.locals) {
            add(`local:${canon(String(p.key.value))}`);
            visit(p.value);
          }
          return;
        }
        const pattern = side === "ts" ? tsPattern(node) : null;
        if (pattern) {
          if (pattern.idiom)
            idioms.set(pattern.idiom, (idioms.get(pattern.idiom) ?? 0) + 1);
          if (pattern.concept) add(`call:${pattern.concept}`);
          for (const k of pattern.ivars ?? []) add(`ivar:${canon(k)}`);
          visit(pattern.visit);
          return;
        }
        const folded = foldCall(node, side);
        if (folded.idiom)
          idioms.set(folded.idiom, (idioms.get(folded.idiom) ?? 0) + 1);
        if (folded.concept === "raise") {
          const cls = constName(node.args[0]);
          add(
            `raise:${cls && /^[A-Z]/.test(cls) ? cls.split("::").pop() : "RuntimeError"}`,
          );
          visit(node.args.slice(cls && /^[A-Z]/.test(cls) ? 1 : 0));
          return;
        }
        if (folded.concept) add(`call:${folded.concept}`);
        for (const v of folded.visit) visit(v);
        return;
      }
      case "if":
        add("branch:if");
        break;
      case "case":
        add("branch:case");
        break;
      case "while":
        add("loop:while");
        break;
      case "begin":
        if (node.rescues?.length) add("rescue");
        if (node.ensure) add("ensure");
        break;
      case "str":
        if (String(node.value).trim())
          add(`lit:${JSON.stringify(normLit(node.value))}`);
        return;
      case "sym":
        if (side === "ruby" && STATUS_SYMBOLS[node.value] !== undefined)
          add(`num:${STATUS_SYMBOLS[node.value]}`);
        else add(`lit:${JSON.stringify(normLit(node.value))}`);
        return;
      case "not":
        if (isLengthRead(node.value)) {
          idioms.set("empty-check", (idioms.get("empty-check") ?? 0) + 1);
          visit(node.value.recv);
          return;
        }
        break;
      case "int":
      case "float":
        add(`num:${Number(node.value)}`);
        return;
      case "regex":
        add(`regex:${normRegex(node)}`);
        return;
      case "unhandled":
        unhandled++;
        return;
      case "iasgn":
        add(`ivar:${canon(String(node.name).replace(/^@/, ""))}`);
        break;
      case "ivar":
        break;
    }
    for (const [k, v] of Object.entries(node))
      if (k !== "k" && v && typeof v === "object") visit(v);
  }
  visit(body);
  return { items, idioms, unhandled };
}

/** Ruby `\\A…\\z` and JS `^…$` anchor the same way on a single-line value. */
function normRegex(n: N): string {
  const src = n.source ?? String(n.value).replace(/^\/(.*)\/[a-z]*$/s, "$1");
  return src.replace(/\\A/g, "^").replace(/\\[zZ]/g, "$");
}

/** An identifier-shaped literal is a key or a name: `:blocked_by` and `"blockedBy"` are one. */
function normLit(s: string): string {
  const t = String(s).replace(/\s+/g, " ").trim();
  return /^[a-z][A-Za-z0-9_]*$/.test(t) ? canon(t) : t;
}

export interface BodyDiff {
  missing: Feature[];
  extra: Feature[];
}

/** Multiset difference by key; the line kept is the first unmatched occurrence. */
export function diffFeatures(ruby: Feature[], ts: Feature[]): BodyDiff {
  const pool = new Map<string, Feature[]>();
  for (const f of ts) pool.set(f.key, [...(pool.get(f.key) ?? []), f]);
  const missing: Feature[] = [];
  for (const f of ruby) {
    const left = pool.get(f.key);
    if (left?.length) left.shift();
    else missing.push(f);
  }
  const extra = [...pool.values()].flat();
  return { missing, extra };
}
