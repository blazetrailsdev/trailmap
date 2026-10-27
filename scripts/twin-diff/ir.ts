/**
 * The IR emitted by `ruby/build-ir.rb`. Nodes are plain JSON objects keyed by
 * `k`; the Ruby front-end has already folded Prism's op-assign, index-write and
 * safe-nav variants into the shapes listed here.
 */
export interface N {
  k: string;
  l?: number;
  [key: string]: any;
}

export interface Param {
  kind: "req" | "opt" | "rest" | "key" | "keyreq" | "keyrest" | "block" | "fwd";
  name?: string | null;
  default?: N;
  destructure?: (string | null)[];
}

export interface IrFile {
  file: string;
  body: N;
}

/** Visit every node below `n` (pre-order), including nested arrays/objects. */
export function walk(n: unknown, fn: (node: N) => void | false): void {
  if (Array.isArray(n)) {
    for (const c of n) walk(c, fn);
    return;
  }
  if (n === null || typeof n !== "object") return;
  const node = n as N;
  if (typeof node.k === "string") {
    if (fn(node) === false) return;
  }
  for (const v of Object.values(node)) {
    if (v !== null && typeof v === "object") walk(v, fn);
  }
}
