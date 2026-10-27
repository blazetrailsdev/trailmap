/**
 * The language decisions: each row says that a Ruby spelling and a JS
 * spelling are the same operation, so a body diff should not report the pair.
 *
 * A row folds a call to a CONCEPT (the name both sides are compared under) or
 * drops it (a call that is only how one language spells something the other
 * says with no call at all: `freeze`, `to_a` on a relation, `String(x)` around
 * an interpolation). Every fold is counted under its row's id, so the report
 * shows which decisions a pair leaned on — a fold that hides a real deviation
 * is visible there, not silent.
 *
 * Rows are matched on the canonical name (`canon`) and, where it matters, on
 * the receiver: `Object.keys(h)` is `h.keys`, not a call named `keys` on
 * `Object`.
 */
import type { N } from "./ir.ts";
import { canon, constName } from "./model.ts";

export type Side = "ruby" | "ts";

export interface Folded {
  concept: string | null;
  idiom?: string;
  visit: N[];
}

interface Row {
  id: string;
  side: Side | "both";
  /** canonical call name(s) this row matches */
  names: string[];
  /** receiver constant the call must have (`Object`, `JSON`, `Math`) */
  recv?: string;
  /** concept to fold to; null drops the call */
  to: string | null;
}

const ROWS: Row[] = [
  // Ruby-only calls that a JS value never needs.
  { id: "freeze", side: "ruby", names: ["freeze", "frozen"], to: null },
  {
    id: "relation-load",
    side: "both",
    names: ["toa", "toarray", "load", "records"],
    to: null,
  },
  // String coercion: Ruby's `nil.to_s` is "" and JS's `String(x)` is its
  // spelling at an interpolation or a typed boundary; neither is a decision.
  { id: "to-s", side: "ruby", names: ["tos", "tostr"], to: null },
  { id: "to-s", side: "ts", names: ["string", "tostring"], to: null },
  { id: "to-i", side: "ruby", names: ["toi", "tof"], to: "to_number" },
  {
    id: "to-i",
    side: "ts",
    names: ["number", "parseint", "parsefloat"],
    to: "to_number",
  },
  { id: "to-sym", side: "ruby", names: ["tosym"], to: null },
  { id: "itself", side: "ruby", names: ["itself"], to: null },
  // Iteration.
  { id: "each", side: "ts", names: ["foreach"], to: "each" },
  { id: "select", side: "ts", names: ["filter"], to: "select" },
  { id: "select", side: "ruby", names: ["filtermap"], to: "select_map" },
  { id: "detect", side: "ruby", names: ["detect"], to: "find" },
  { id: "include", side: "ts", names: ["includes", "has"], to: "include" },
  {
    id: "include",
    side: "ruby",
    names: ["include", "member", "key", "haskey"],
    to: "include",
  },
  { id: "any", side: "ts", names: ["some"], to: "any" },
  { id: "all", side: "ts", names: ["every"], to: "all" },
  { id: "length", side: "both", names: ["length", "size"], to: "length" },
  { id: "inject", side: "ts", names: ["reduce"], to: "inject" },
  { id: "inject", side: "ruby", names: ["sum"], to: "inject" },
  { id: "push", side: "ts", names: ["push"], to: "<<" },
  { id: "push", side: "ruby", names: ["append"], to: "<<" },
  { id: "concat", side: "both", names: ["concat"], to: "<<" },
  { id: "flat-map", side: "both", names: ["flatmap"], to: "flat_map" },
  {
    id: "sort",
    side: "ruby",
    names: ["sortby", "sort", "minby", "maxby"],
    to: "sort",
  },
  { id: "sort", side: "ts", names: ["sort", "tosorted"], to: "sort" },
  { id: "uniq", side: "ruby", names: ["uniq"], to: "uniq" },
  { id: "first", side: "ts", names: ["at"], to: "first" },
  {
    id: "entries",
    side: "ts",
    names: ["entries"],
    recv: "Object",
    to: "each_pair",
  },
  { id: "entries", side: "ruby", names: ["eachpair", "toa"], to: "each_pair" },
  { id: "keys", side: "ts", names: ["keys"], recv: "Object", to: "keys" },
  { id: "values", side: "ts", names: ["values"], recv: "Object", to: "values" },
  {
    id: "to-h",
    side: "ts",
    names: ["fromentries"],
    recv: "Object",
    to: "to_h",
  },
  {
    id: "to-h",
    side: "ruby",
    names: ["toh", "indexby", "indexwith"],
    to: "to_h",
  },
  {
    id: "transform-values",
    side: "ruby",
    names: ["transformvalues", "transformkeys"],
    to: "to_h",
  },
  {
    id: "group-by",
    side: "ts",
    names: ["groupby"],
    recv: "Map",
    to: "group_by",
  },
  {
    id: "group-by",
    side: "ts",
    names: ["groupby"],
    recv: "Object",
    to: "group_by",
  },
  { id: "is-array", side: "ts", names: ["isarray"], recv: "Array", to: "is_a" },
  {
    id: "is-a",
    side: "ruby",
    names: ["isa", "kindof", "instanceof"],
    to: "is_a",
  },
  { id: "array-from", side: "ts", names: ["from"], recv: "Array", to: null },
  { id: "array-wrap", side: "ruby", names: ["wrap"], recv: "Array", to: null },
  { id: "array-new", side: "ruby", names: ["toset"], to: "new_set" },
  { id: "dup", side: "ruby", names: ["dup", "clone"], to: null },
  { id: "math", side: "ts", names: ["max", "min"], recv: "Math", to: "max" },
  { id: "math", side: "ruby", names: ["max", "min", "clamp"], to: "max" },
  {
    id: "floor",
    side: "ts",
    names: ["trunc", "floor", "round", "ceil"],
    recv: "Math",
    to: "round",
  },
  {
    id: "floor",
    side: "ruby",
    names: ["truncate", "floor", "round", "ceil", "toi"],
    to: "round",
  },
  // Strings.
  { id: "strip", side: "ts", names: ["trim"], to: "strip" },
  { id: "downcase", side: "ts", names: ["tolowercase"], to: "downcase" },
  { id: "upcase", side: "ts", names: ["touppercase"], to: "upcase" },
  { id: "starts-with", side: "ts", names: ["startswith"], to: "start_with" },
  { id: "ends-with", side: "ts", names: ["endswith"], to: "end_with" },
  { id: "replace", side: "ts", names: ["replace", "replaceall"], to: "sub" },
  {
    id: "replace",
    side: "ruby",
    names: ["sub", "gsub", "tr", "delete"],
    to: "sub",
  },
  { id: "match", side: "ts", names: ["test", "match", "exec"], to: "match" },
  { id: "match", side: "ruby", names: ["match", "=~", "scan"], to: "match" },
  { id: "slice", side: "ts", names: ["slice", "substring"], to: "[]" },
  {
    id: "slice",
    side: "ruby",
    names: ["[]", "slice", "first", "last", "take", "drop"],
    to: "[]",
  },
  { id: "pad", side: "ts", names: ["padstart", "padend"], to: "format" },
  {
    id: "pad",
    side: "ruby",
    names: ["rjust", "ljust", "format"],
    to: "format",
  },
  { id: "json", side: "ts", names: ["parse"], recv: "JSON", to: "json_parse" },
  { id: "json", side: "ts", names: ["stringify"], recv: "JSON", to: "to_json" },
  {
    id: "json",
    side: "ruby",
    names: ["parse"],
    recv: "JSON",
    to: "json_parse",
  },
  {
    id: "json",
    side: "ruby",
    names: ["generate", "dump", "tojson"],
    to: "to_json",
  },
  {
    id: "url-encode",
    side: "ruby",
    names: ["urlencode", "escape", "uencode"],
    to: "encodeuricomponent",
  },
  { id: "iso8601", side: "ts", names: ["toisostring"], to: "iso8601" },
  {
    id: "sign",
    side: "ruby",
    names: ["positive", "negative", "zero", "nonzero"],
    to: null,
  },
  // Ruby truthiness helpers whose JS spelling is no call (`!x`, `x ?? d`).
  {
    id: "truthiness",
    side: "ruby",
    names: ["nil", "present", "blank", "presence", "empty", "any", "none"],
    to: null,
  },
  { id: "fetch", side: "ruby", names: ["fetch", "dig"], to: "[]" },
  { id: "fetch", side: "ts", names: ["get"], to: "[]" },
  {
    id: "is-nan",
    side: "ts",
    names: ["isnan", "isfinite", "isinteger"],
    recv: "Number",
    to: null,
  },
  // Object construction.
  { id: "raise", side: "both", names: ["raise", "fail"], to: "raise" },
  {
    id: "ruby-require",
    side: "ruby",
    names: ["require", "requirerelative"],
    to: null,
  },
  { id: "ruby-equal", side: "both", names: ["==", "!=", "==="], to: null },
  {
    id: "operators",
    side: "both",
    names: [
      "<",
      "<=",
      ">",
      ">=",
      "+",
      "-",
      "*",
      "/",
      "%",
      "**",
      "<=>",
      "!@",
      "-@",
      "+@",
    ],
    to: null,
  },
];

const BY_SIDE: Record<Side, Map<string, Row[]>> = {
  ruby: new Map(),
  ts: new Map(),
};
for (const row of ROWS) {
  for (const side of row.side === "both"
    ? (["ruby", "ts"] as const)
    : [row.side]) {
    for (const name of row.names)
      BY_SIDE[side].set(name, [...(BY_SIDE[side].get(name) ?? []), row]);
  }
}

/** Rack's status symbols, so `head :not_found` meets `status: 404`. */
export const STATUS_SYMBOLS: Record<string, number> = {
  ok: 200,
  created: 201,
  accepted: 202,
  no_content: 204,
  moved_permanently: 301,
  found: 302,
  see_other: 303,
  not_modified: 304,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  request_timeout: 408,
  conflict: 409,
  gone: 410,
  unprocessable_entity: 422,
  unprocessable_content: 422,
  too_many_requests: 429,
  internal_server_error: 500,
  bad_gateway: 502,
  service_unavailable: 503,
  gateway_timeout: 504,
};

/**
 * Ruby modules the twin carries only to give Ruby a JS built-in's semantics
 * (ICU-free `localeCompare`, a stable `Array#sort`): a call to one is the
 * built-in's call.
 */
const SHIMS: Record<string, string> = {
  "LocaleCompare.compare": "localecompare",
  "StableSort.sort": "sort",
};

const isLitKey = (n: N | undefined) => !!n && (n.k === "sym" || n.k === "str");

/** Ruby Struct names the twin builds where TS writes an object literal; `cli.ts` fills it. */
export const STRUCTS = new Set<string>();

export function foldCall(node: N, side: Side): Folded {
  const name = canon(String(node.name));
  const recvName = constName(node.recv);
  const args: N[] = node.args ?? [];
  const recvVisit = node.recv ? [node.recv] : [];
  const blockVisit = node.block ? [node.block] : [];

  // `h[:status]`, `h["status"]`, `map.get("status")`, `obj.status` are one read;
  // `h[:k] = v`, `map.set("k", v)`, `obj.k = v` one write.
  const indexRead =
    node.name === "[]" ||
    (side === "ts" && node.name === "get") ||
    (side === "ruby" && node.name === "fetch");
  const indexWrite =
    node.name === "[]=" || (side === "ts" && node.name === "set");
  if ((indexRead || indexWrite) && isLitKey(args[0]) && node.recv)
    return {
      concept: canon(String(args[0].value)),
      idiom: "hash-key",
      visit: [...recvVisit, ...args.slice(1), ...blockVisit],
    };
  if (indexWrite)
    return {
      concept: "[]",
      idiom: "hash-key",
      visit: [...recvVisit, ...args, ...blockVisit],
    };

  const shim = SHIMS[`${recvName}.${node.name}`];
  if (side === "ruby" && shim)
    return {
      concept: shim,
      idiom: "ruby-shim",
      visit: [...args, ...blockVisit],
    };
  if (side === "ruby" && node.name === "!")
    return { concept: null, idiom: "not", visit: recvVisit };
  if (
    node.name === "new" &&
    (recvName === "Map" || recvName === "Hash" || recvName === "Object")
  )
    return {
      concept: null,
      idiom: "hash-new",
      visit: [...args, ...blockVisit],
    };
  if (
    (node.name === "new" && recvName === "Set") ||
    (side === "ruby" && node.name === "to_set")
  )
    return {
      concept: "newset",
      idiom: "set-new",
      visit: [...recvVisit, ...args, ...blockVisit],
    };

  const rows = BY_SIDE[side].get(name) ?? [];
  const row = rows.find((r) => r.recv === undefined || r.recv === recvName);
  const visit: N[] = [...args, ...blockVisit];
  if (row?.recv === undefined && node.recv) visit.unshift(node.recv);
  if (row)
    return {
      concept: row.to === null ? null : canon(row.to),
      idiom: row.id,
      visit,
    };
  if (node.name === "new" && node.recv)
    return { concept: `new:${recvName}`, visit };
  return { concept: name, visit };
}
