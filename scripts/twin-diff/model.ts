/**
 * Units of comparison, extracted the same way from either side's IR.
 *
 * A unit is a class or module (or, on the TS side, a file's top-level
 * functions and constants, which is how trailmap writes a Ruby module of
 * `def self.` functions). It carries its class-body declarations — the
 * `has_many` / `validate` / `before_action` calls, which a TS class makes in
 * a `static {}` block — its constants, and its methods.
 */
import type { N } from "./ir.ts";

export interface Decl {
  name: string;
  args: N[];
  block: N | null;
  line: number;
}

export interface Method {
  name: string;
  singleton: boolean;
  private: boolean;
  params: string[];
  body: N;
  line: number;
  declared?: boolean;
}

export interface Unit {
  name: string;
  kind: "class" | "module" | "file";
  superclass: string | null;
  decls: Decl[];
  consts: Map<string, N>;
  methods: Method[];
  line: number;
  file: string;
  /** Struct members (Ruby `Struct.new(:a, :b)`; TS interface / object type properties) */
  members?: string[];
}

/** Ruby and TS spellings of one name meet here: `days_since`, `daysSince`, `isReadableBy`/`readable_by?`, `setX`/`x=`. */
export function canon(name: string): string {
  if (name === "[]=") return "[]";
  if (!/^[A-Za-z_]/.test(name)) return name;
  return name
    .replace(/^(is|set)(?=[A-Z])/, "")
    .replace(/[?!=]$/, "")
    .replace(/_/g, "")
    .toLowerCase();
}

/** Ruby's root exception class and JS's are one decision. */
const CONST_ALIASES: Record<string, string> = {
  StandardError: "Error",
  RuntimeError: "Error",
};

export function constName(n: N | null | undefined): string | null {
  if (!n) return null;
  if (n.k === "const") {
    const path = (n.path as string[]).join("::");
    return CONST_ALIASES[path] ?? path;
  }
  if (n.k === "call" && n.recv) return `${constName(n.recv)}.${n.name}`;
  if (n.k === "lvar") return n.name;
  return n.k;
}

const MEMBER_MACROS = new Set([
  "attr_reader",
  "attr_accessor",
  "attr_writer",
  "alias_method",
  "class_attribute",
  "cattr_accessor",
  "mattr_accessor",
]);
const VISIBILITY = new Set([
  "private",
  "protected",
  "public",
  "module_function",
]);

export function extractUnits(
  file: string,
  root: N,
  side: "ruby" | "ts",
): Unit[] {
  const units: Unit[] = [];
  const fileUnit: Unit = {
    name: file,
    kind: "file",
    superclass: null,
    decls: [],
    consts: new Map(),
    methods: [],
    line: 1,
    file,
  };

  function body(n: N | null | undefined): N[] {
    if (!n) return [];
    return n.k === "seq" ? (n.body as N[]) : [n];
  }

  function visit(
    nodes: N[],
    prefix: string,
    unit: Unit | null,
    singletonCtx = false,
  ) {
    let visibility = "public";
    const privateClassMethods = new Set<string>();
    for (const n of nodes) {
      if (n.k === "class" || n.k === "module") {
        const name = [prefix, ...(n.path as string[])]
          .filter(Boolean)
          .join("::");
        const u: Unit = {
          name,
          kind: n.k,
          superclass: n.superclass
            ? constName(n.superclass)
            : n.struct
              ? "Struct"
              : null,
          members: n.struct?.members,
          decls: [],
          consts: new Map(),
          methods: [],
          line: n.l ?? 0,
          file,
        };
        units.push(u);
        visit(body(n.body), name, u);
        continue;
      }
      const target = unit ?? fileUnit;
      if (n.k === "sclass") {
        visit(body(n.body), prefix, unit, true);
        continue;
      }
      if (n.k === "def") {
        target.methods.push({
          name: n.name,
          singleton:
            !!n.singleton || singletonCtx || visibility === "module_function",
          private:
            side === "ts"
              ? !!n.private
              : visibility !== "public" && visibility !== "module_function",
          params: ((n.params ?? []) as { name?: string | null; kind: string }[])
            .filter((p) => p.kind !== "block")
            .map((p) => p.name ?? "_"),
          body: n.body,
          line: n.l ?? 0,
        });
        continue;
      }
      if (
        n.k === "casgn" &&
        side === "ts" &&
        n.value?.k === "hash" &&
        (n.value.pairs as { value: N }[]).some(
          (p) => p.value.k === "lambda" || p.value.k === "block",
        )
      ) {
        // `export const JsonArray = { load(…) {…}, dump: (…) => … }` is a module of functions.
        units.push({
          name: [prefix, ...(n.path as string[])].filter(Boolean).join("::"),
          kind: "module",
          superclass: null,
          decls: [],
          consts: new Map(),
          methods: (n.value.pairs as { key: N; value: N }[])
            .filter((p) => p.value.k === "lambda" || p.value.k === "block")
            .map((p) => ({
              name: String(p.key.value),
              singleton: true,
              private: false,
              params: (p.value.params ?? []).map(
                (x: { name?: string }) => x.name ?? "_",
              ),
              body: p.value.body,
              line: n.l ?? 0,
            })),
          line: n.l ?? 0,
          file,
        });
        continue;
      }
      if (n.k === "casgn") {
        target.consts.set((n.path as string[]).join("::"), n.value);
        const isStruct =
          n.value?.k === "call" &&
          ((constName(n.value.recv) === "Struct" && n.value.name === "new") ||
            (constName(n.value.recv) === "Data" && n.value.name === "define"));
        if (isStruct) {
          const members = (n.value.args as N[])
            .filter((a) => a.k === "sym")
            .map((a) => a.value as string);
          units.push({
            members,
            name: [prefix, ...(n.path as string[])].filter(Boolean).join("::"),
            kind: "class",
            superclass: "Struct",
            decls: [],
            consts: new Map(),
            methods: [],
            line: n.l ?? 0,
            file,
          });
        }
        continue;
      }
      if (n.k === "tsinterface") {
        units.push({
          name: [prefix, n.name].filter(Boolean).join("::"),
          kind: "class",
          superclass: "Struct",
          members: n.members,
          decls: [],
          consts: new Map(),
          methods: [],
          line: n.l ?? 0,
          file,
        });
        continue;
      }
      if (n.k === "tsdecl") {
        target.methods.push({
          name: n.name,
          singleton: !!n.static,
          private: false,
          params: [],
          body: { k: "seq", body: [] },
          line: n.l ?? 0,
          declared: true,
        });
        continue;
      }
      if (
        n.k === "call" &&
        (n.name === "each" || n.name === "forEach") &&
        unit
      ) {
        // A TS class body loops where Ruby writes one line per item:
        // `for (const c of ["a", "b"]) this.serialize(c, …)`.
        const unrolled = unrollLiteralLoop(n);
        if (unrolled) {
          visit(unrolled, prefix, unit, singletonCtx);
          continue;
        }
      }
      if (unit && side === "ts" && (n.k === "iasgn" || n.k === "tsfield")) {
        // `this.tableName = "meta"` in a static block and `static abstractClass = true`
        // are Ruby's `self.table_name = "meta"`; an instance field is a member.
        if (n.k === "tsfield" && !n.static) {
          unit.methods.push({
            name: n.name,
            singleton: false,
            private: false,
            params: [],
            body: { k: "seq", body: [] },
            line: n.l ?? 0,
            declared: true,
          });
        } else {
          unit.decls.push({
            name: `${n.name}=`,
            args: [n.value],
            block: null,
            line: n.l ?? 0,
          });
        }
        continue;
      }
      if (n.k === "call" && (n.recv === null || n.recv?.k === "self")) {
        if (VISIBILITY.has(n.name) && n.args.length === 0 && !n.block) {
          visibility = n.name;
          continue;
        }
        if (n.name === "private_class_method") {
          for (const a of n.args)
            if (a.k === "sym") privateClassMethods.add(a.value);
          continue;
        }
        if (
          (n.name === "included" || n.name === "class_methods") &&
          n.block &&
          side === "ruby"
        ) {
          visit(body(n.block.body), prefix, unit, n.name === "class_methods");
          continue;
        }
        if (
          side === "ruby" &&
          n.name === "extend" &&
          constName(n.args[0])?.endsWith("Concern")
        )
          continue;
        if (side === "ruby" && MEMBER_MACROS.has(n.name) && unit) {
          // `attr_reader :code`, `alias_method :a, :b`, `class_attribute :tab` define members.
          const names = n.name === "alias_method" ? [n.args[0]] : n.args;
          for (const a of names)
            if (a?.k === "sym" || a?.k === "str")
              unit.methods.push({
                name: String(a.value),
                singleton: n.name === "class_attribute",
                private: visibility === "private",
                params: [],
                body: { k: "seq", body: [] },
                line: n.l ?? 0,
                declared: true,
              });
          continue;
        }
        // TS `include(this, Mod)` is Ruby's `include Mod`.
        const args =
          side === "ts" &&
          (n.name === "include" || n.name === "extend") &&
          n.args[0]?.k === "self"
            ? n.args.slice(1)
            : n.args;
        target.decls.push({
          name: n.name,
          args,
          block: n.block,
          line: n.l ?? 0,
        });
        continue;
      }
      if (unit === null && side === "ts") continue;
      if (unit && n.k === "call")
        target.decls.push({
          name: constName(n.recv) + "." + n.name,
          args: n.args,
          block: n.block,
          line: n.l ?? 0,
        });
    }
    if (unit)
      for (const m of unit.methods)
        if (m.singleton && privateClassMethods.has(m.name)) m.private = true;
  }

  visit(body(root), "", null);
  if (fileUnit.methods.length || fileUnit.consts.size) units.push(fileUnit);
  return units;
}

function unrollLiteralLoop(n: N): N[] | null {
  if (n.recv?.k !== "array" || !n.block) return null;
  const param = n.block.params?.[0]?.name;
  if (!param) return null;
  const elems = n.recv.elems as N[];
  if (!elems.every((e) => e.k === "str" || e.k === "sym" || e.k === "int"))
    return null;
  return elems.flatMap(
    (e) => (substitute(n.block.body, param, e) as N).body as N[],
  );
}

function substitute(n: unknown, name: string, value: N): unknown {
  if (Array.isArray(n)) return n.map((x) => substitute(x, name, value));
  if (n === null || typeof n !== "object") return n;
  const node = n as N;
  if (node.k === "lvar" && node.name === name) return value;
  return Object.fromEntries(
    Object.entries(node).map(([k, v]) => [k, substitute(v, name, value)]),
  );
}
