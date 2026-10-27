/**
 * Templates. Each side's template is compared twice: its code — the `<% %>`
 * and `<%= %>` tags, compiled into one function body the body diff reads like
 * any method — and its markup, the tags and text left when the code is taken
 * out. `ruby-ir.rb` compiles the ERB half; this file compiles the TSE half and
 * extracts both sides' markup.
 */
import type { Feature } from "./features.ts";

const TAG = /<%(=|#)?-?([\s\S]*?)-?%>/g;

const lineAt = (src: string, offset: number) =>
  src.slice(0, offset).split("\n").length;

/** TSE → a TS function body, padded so its lines are the template's lines. */
export function tseToTs(src: string): string {
  let code = "function __template() {";
  for (const m of src.matchAll(TAG)) {
    const [, kind, body] = m;
    if (kind === "#") continue;
    const line = lineAt(src, m.index!);
    code += "\n".repeat(Math.max(line - code.split("\n").length, 0));
    code += kind === "=" ? `__out(${body.trim()});` : `${body.trim()}\n`;
  }
  return code + "\n}\n";
}

/**
 * The markup a template writes: every element with its attributes (a dynamic
 * value is `§`, and a class list is sorted), and every run of literal text.
 */
export function markupFeatures(src: string): Feature[] {
  const out: Feature[] = [];
  // Keep offsets: replace each code tag with a same-length run, `§` for an output.
  const text = src.replace(TAG, (all, kind: string | undefined) =>
    kind === "="
      ? "§".padEnd(all.length, " ")
      : " "
          .repeat(all.length)
          .replace(/ /g, (c, i) => (all[i] === "\n" ? "\n" : c)),
  );
  const ELEMENT =
    /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  const pushText = (s: string, at: number) => {
    const t = s.replace(/§\s*/g, "§").replace(/\s+/g, " ").trim();
    if (t && t !== "§" && /[^\s§]/.test(t))
      out.push({ key: `text:${JSON.stringify(t)}`, line: lineAt(src, at) });
  };
  for (const m of text.matchAll(ELEMENT)) {
    pushText(text.slice(last, m.index), last);
    last = m.index! + m[0].length;
    if (m[0].startsWith("</")) continue;
    const attrs = [
      ...m[2].matchAll(/([^\s=>]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g),
    ]
      .map(([, name, a, b, c]) => {
        let v = (a ?? b ?? c ?? "").replace(/§\s*/g, "§").trim();
        if (name === "class") v = v.split(/\s+/).sort().join(" ");
        return v ? `${name}="${v}"` : name;
      })
      .sort();
    out.push({
      key: `html:<${m[1].toLowerCase()}${attrs.length ? " " + attrs.join(" ") : ""}>`,
      line: lineAt(src, m.index!),
    });
  }
  pushText(text.slice(last), last);
  return out;
}

/** `views/repo_issues/_row.html.erb` → `views/repo-issues/_row.html.tse` */
export function viewTwinPath(erb: string): string {
  return erb
    .replace(/_/g, "-")
    .replace(/\/-/g, "/_")
    .replace(/\.erb$/, ".tse");
}
