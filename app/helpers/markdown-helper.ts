/**
 * A small, dependency-free markdown renderer for the story and RFC show pages.
 *
 * This is a port of btwhooks' `webhook/markdown.go` (276 lines, stdlib-only by
 * choice), kept construct for construct so a reader moving between the two
 * dashboards sees the same document: ATX headers, fenced code, bullet/ordered
 * lists, blockquotes, horizontal rules, paragraphs, GFM tables, and inline
 * code/bold/italic/links. It is intentionally not a full CommonMark
 * implementation — the ringo original is not one either, and matching it is
 * the point. No npm markdown library is pulled in for the same reason: the
 * two behaviours the pages actually depend on — wiki links and the href gate
 * — are the two a stock renderer would not give us anyway.
 *
 * All text is HTML-escaped; only the tags emitted here are trusted, so the
 * result is safe to hand a view as a SafeBuffer. RFC and story bodies are
 * authored by agents, so the body is NOT trusted input.
 *
 * Spot-checked against 120 real RFC and story bodies: the output is byte
 * identical to ringo's but for the spelling of the double-quote entity, which
 * trails escapes as `&quot;` where Go's `html.EscapeString` writes `&#34;`.
 * The two render the same character, so the framework's own escaper is used
 * rather than hand-rolling Go's table.
 */
import { SafeBuffer, htmlEscape, htmlSafe } from "@blazetrails/activesupport";

/**
 * The three line regexes carry `s` (dotAll) for a reason that is invisible
 * until a document hits it: JavaScript's `.` excludes U+2028 and U+2029 as
 * well as the newlines, where Go's excludes only `\n`. A bullet mentioning
 * LINE SEPARATOR therefore failed `(.*)$` here and matched in ringo, which
 * closed the list one item early and made the rest of it a paragraph. The
 * subject is always a single line, so letting `.` match a newline as well
 * costs nothing.
 */
const mdHeaderRE = /^(#{1,6})\s+(.*?)\s*#*$/s;
const mdBulletRE = /^[ \t]*[-*+]\s+(.*)$/s;
const mdOrderedRE = /^[ \t]*\d+\.\s+(.*)$/s;
const mdLinkRE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
/** mdWikiRE matches cross-story links: [[story-id]] or [[story-id|label]]. */
const mdWikiRE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const mdBoldRE = /\*\*([^*]+?)\*\*/g;
const mdItalicRE = /\*([^*\s][^*]*?)\*/g;
/**
 * mdTableSepRE matches a GFM table delimiter row: pipe-separated runs of
 * dashes with optional alignment colons, e.g. "| :--- | ---: | :--: |".
 */
const mdTableSepRE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** renderMarkdown converts markdown source to safe HTML. */
export function renderMarkdown(src: string): SafeBuffer {
  const lines = (src ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
    } else if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      const fence = trimmed.slice(0, 3);
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i]!.trim().startsWith(fence)) {
        code.push(lines[i]!);
        i++;
      }
      i++; // consume closing fence (no-op past EOF)
      out.push("<pre><code>", escapeText(code.join("\n")), "</code></pre>");
    } else if (trimmed.startsWith("<!--")) {
      // HTML comment (e.g. the "<!-- comments: N -->" review sentinel):
      // skip it entirely, across lines until the closing marker.
      while (i < lines.length && !lines[i]!.includes("-->")) i++;
      i++;
    } else if (mdHeaderRE.test(line)) {
      const m = mdHeaderRE.exec(line)!;
      const n = m[1]!.length;
      out.push(`<h${n}>`, renderInline(m[2]!), `</h${n}>`);
      i++;
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      out.push("<hr>");
      i++;
    } else if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        quote.push(lines[i]!.trim().slice(1).trim());
        i++;
      }
      out.push("<blockquote>", renderInline(quote.join(" ")), "</blockquote>");
    } else if (mdBulletRE.test(line) || mdOrderedRE.test(line)) {
      const ordered = mdOrderedRE.test(line);
      const tag = ordered ? "ol" : "ul";
      const re = ordered ? mdOrderedRE : mdBulletRE;
      out.push(`<${tag}>`);
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (m === null) break;
        out.push("<li>", renderInline(m[1]!), "</li>");
        i++;
      }
      out.push(`</${tag}>`);
    } else if (line.includes("|") && i + 1 < lines.length && mdTableSepRE.test(lines[i + 1]!)) {
      // GFM table: a header row containing a pipe immediately followed by a
      // delimiter row of dashes/colons. Both stories and RFCs use them, and
      // they otherwise render as raw "| a | b |" text.
      const headers = splitTableRow(line);
      const aligns = tableAligns(lines[i + 1]!, headers.length);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        rows.push(splitTableRow(lines[i]!));
        i++;
      }
      out.push("<table><thead><tr>");
      headers.forEach((h, c) => {
        out.push(`<th${alignAttr(aligns, c)}>`, renderInline(h), "</th>");
      });
      out.push("</tr></thead><tbody>");
      for (const row of rows) {
        out.push("<tr>");
        for (let c = 0; c < headers.length; c++) {
          out.push(`<td${alignAttr(aligns, c)}>`, renderInline(row[c] ?? ""), "</td>");
        }
        out.push("</tr>");
      }
      out.push("</tbody></table>");
    } else {
      const para: string[] = [];
      while (i < lines.length) {
        if (lines[i]!.trim() === "" || mdIsBlockStart(lines[i]!)) break;
        para.push(lines[i]!);
        i++;
      }
      out.push("<p>", renderInline(para.join(" ")), "</p>");
    }
  }
  return htmlSafe(out.join(""));
}

/**
 * mdIsBlockStart reports whether a line begins a non-paragraph block, so
 * paragraph accumulation stops before swallowing it.
 */
function mdIsBlockStart(line: string): boolean {
  const t = line.trim();
  if (
    t.startsWith("```") ||
    t.startsWith("~~~") ||
    t.startsWith("<!--") ||
    t.startsWith(">") ||
    t === "---" ||
    t === "***" ||
    t === "___"
  ) {
    return true;
  }
  return mdHeaderRE.test(line) || mdBulletRE.test(line) || mdOrderedRE.test(line);
}

/**
 * splitTableRow splits a GFM table row into trimmed cells, dropping the
 * optional leading/trailing pipes. It does not handle escaped pipes inside
 * cells — rare in these docs and not worth the complexity here.
 */
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((p) => p.trim());
}

/**
 * tableAligns reads per-column alignment from a delimiter row: leading colon =
 * left, trailing = right, both = center, neither = default (empty).
 */
function tableAligns(sep: string, n: number): string[] {
  const cells = splitTableRow(sep);
  const outAligns: string[] = new Array(n).fill("");
  for (let i = 0; i < n && i < cells.length; i++) {
    const c = cells[i]!;
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) outAligns[i] = "center";
    else if (right) outAligns[i] = "right";
    else if (left) outAligns[i] = "left";
  }
  return outAligns;
}

/** alignAttr renders the style attribute for a table cell's column alignment. */
function alignAttr(aligns: string[], c: number): string {
  if (c < aligns.length && aligns[c] !== "") return ` style="text-align:${aligns[c]}"`;
  return "";
}

/**
 * renderInline renders inline markdown. Code spans are handled first and their
 * contents left verbatim (escaped, no further markup), so emphasis markers
 * inside `code` are not interpreted.
 */
function renderInline(input: string): string {
  let s = input;
  const out: string[] = [];
  for (;;) {
    const i = s.indexOf("`");
    if (i < 0) {
      out.push(renderInlineText(s));
      break;
    }
    const j = s.indexOf("`", i + 1);
    if (j < 0) {
      out.push(renderInlineText(s));
      break;
    }
    out.push(renderInlineText(s.slice(0, i)), "<code>", escapeText(s.slice(i + 1, j)), "</code>");
    s = s.slice(j + 1);
  }
  return out.join("");
}

/**
 * The characters Go's `url.PathEscape` leaves alone: the unreserved set plus
 * the sub-delimiters that are legal unencoded in a path segment.
 */
const goPathUnreserved = /[A-Za-z0-9\-_.~$&+:=@]/;

/**
 * `url.PathEscape` (webhook/markdown.go:255), not `encodeURIComponent`. The
 * two agree on nearly everything and disagree on both edges: Go leaves
 * `$ & + : = @` unescaped where JavaScript escapes them, and escapes
 * `! ' ( ) *` where JavaScript leaves them. A story id carrying an `=` — they
 * exist — rendered a different href on the two dashboards, which is exactly
 * the drift the markdown gate is there to catch.
 */
function pathEscape(id: string): string {
  return [...id]
    .map((ch) => {
      if (goPathUnreserved.test(ch)) return ch;
      // `encodeURIComponent` leaves `!'()*` alone, which is the other half of
      // the disagreement: Go escapes them, so they are encoded by hand.
      return encodeURIComponent(ch).replace(/[!'()*]/g, (c) =>
        `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    })
    .join("");
}

/**
 * renderInlineText escapes text then applies links and emphasis. Markdown
 * syntax characters ([](), *) survive HTML escaping, so escaping first is safe.
 * Underscore emphasis is deliberately not supported — it would mangle
 * snake_case identifiers and file names common in reviews.
 */
function renderInlineText(input: string): string {
  let s = escapeText(input);
  // Cross-story wiki links resolve to the story show page. Run before the
  // standard link pass; [[id]] has no "(" so the two regexes don't overlap.
  s = s.replace(mdWikiRE, (_m, rawId: string, rawLabel: string | undefined) => {
    const id = unescapeText(rawId).trim();
    const label = (rawLabel ?? "").trim() === "" ? rawId : rawLabel!;
    return `<a href="/story/${pathEscape(id)}">${label}</a>`;
  });
  s = s.replace(mdLinkRE, (m, text: string, href: string) => {
    if (!mdSafeUrl(unescapeText(href))) return m;
    return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  });
  s = s.replace(mdBoldRE, "<strong>$1</strong>");
  s = s.replace(mdItalicRE, "<em>$1</em>");
  return s;
}

/** escapeText escapes body text, which is never trusted. */
function escapeText(s: string): string {
  return htmlEscape(s).toString();
}

/**
 * unescapeText reverses {@link escapeText}. Only the entities the escaper
 * emits are reversed — the input at this point is our own output, so a general
 * entity decoder would be a wider surface than the port needs.
 */
function unescapeText(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** mdSafeUrl allows only link targets that can't execute script. */
function mdSafeUrl(u: string): boolean {
  const l = u.trim().toLowerCase();
  return (
    l.startsWith("http://") ||
    l.startsWith("https://") ||
    l.startsWith("mailto:") ||
    l.startsWith("/") ||
    l.startsWith("#")
  );
}

/** The view-facing surface, alongside ApplicationHelper. */
export const MarkdownHelper = {
  renderMarkdown,
};
