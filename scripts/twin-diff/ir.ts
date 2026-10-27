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
