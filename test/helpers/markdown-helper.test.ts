/**
 * The markdown renderer, ported from btwhooks' `webhook/markdown.go`.
 *
 * The three cases from `markdown_test.go` are carried over verbatim — wiki
 * links, tables, and the pipe-bearing paragraph that must NOT become a table —
 * because those are the ones the ringo renderer regressed on. The rest cover
 * the block and inline constructs the port has to reproduce, plus a hostile
 * body: RFC and story prose is written by agents, so the renderer is the only
 * thing standing between an injected `<script>` and the show page.
 */
import { describe, expect, it } from "vitest";
import { MarkdownHelper, renderMarkdown } from "../../app/helpers/markdown-helper.js";

const render = (src: string): string => renderMarkdown(src).toString();

describe("renderMarkdown wiki links", () => {
  const cases = [
    { name: "bare id", src: "see [[story-foo-12]] for context", want: `<a href="/story/story-foo-12">story-foo-12</a>` },
    {
      name: "id with label",
      src: "blocked by [[story-bar-3|the auth work]]",
      want: `<a href="/story/story-bar-3">the auth work</a>`,
    },
    { name: "id needing url escaping", src: "[[story a/b]]", want: `<a href="/story/story%20a%2Fb">story a/b</a>` },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(render(c.src)).toContain(c.want);
    });
  }
});

describe("renderMarkdown tables", () => {
  it("renders a header, alignment, and body cells", () => {
    const got = render("| Name | Count |\n| ---- | ----: |\n| `a` | 1 |\n| b | 2 |");
    for (const want of [
      "<table>",
      "<thead>",
      "<th>Name</th>",
      `<th style="text-align:right">Count</th>`,
      "<tbody>",
      "<td><code>a</code></td>",
      `<td style="text-align:right">1</td>`,
      "<td>b</td>",
      "</table>",
    ]) {
      expect(got).toContain(want);
    }
  });

  it("reads left and center alignment from the delimiter row", () => {
    const got = render("| a | b |\n| :--- | :--: |\n| 1 | 2 |");
    expect(got).toContain(`<th style="text-align:left">a</th>`);
    expect(got).toContain(`<th style="text-align:center">b</th>`);
  });

  it("pads a short row out to the header's column count", () => {
    expect(render("| a | b |\n| --- | --- |\n| 1 |")).toContain("<td>1</td><td></td>");
  });
});

describe("renderMarkdown table not hr or paragraph", () => {
  it("leaves a pipe-bearing paragraph with no delimiter row alone", () => {
    expect(render("use a | b for the union")).not.toContain("<table>");
  });
});

describe("renderMarkdown blocks", () => {
  it("renders ATX headers at their level", () => {
    expect(render("## Context")).toBe("<h2>Context</h2>");
    expect(render("###### deep ######")).toBe("<h6>deep</h6>");
  });

  it("renders fenced code verbatim", () => {
    expect(render("```go\nif a < b {\n}\n```")).toBe("<pre><code>if a &lt; b {\n}</code></pre>");
  });

  it("renders bullet and ordered lists", () => {
    expect(render("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
    expect(render("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("joins a blockquote's lines", () => {
    expect(render("> first\n> second")).toBe("<blockquote>first second</blockquote>");
  });

  it("renders horizontal rules", () => {
    expect(render("---")).toBe("<hr>");
    expect(render("***")).toBe("<hr>");
    expect(render("___")).toBe("<hr>");
  });

  it("joins a paragraph's lines and stops at the next block", () => {
    expect(render("one\ntwo\n## next")).toBe("<p>one two</p><h2>next</h2>");
  });

  it("skips HTML comments entirely", () => {
    expect(render("<!-- comments: 3 -->\nbody")).toBe("<p>body</p>");
    expect(render("<!-- a\nb -->\nbody")).toBe("<p>body</p>");
  });
});

describe("renderMarkdown inline", () => {
  it("renders code, bold, and italic", () => {
    expect(render("a `x < y` b **bold** c *italic* d")).toBe(
      "<p>a <code>x &lt; y</code> b <strong>bold</strong> c <em>italic</em> d</p>",
    );
  });

  it("leaves emphasis markers inside a code span uninterpreted", () => {
    expect(render("`**not bold**`")).toBe("<p><code>**not bold**</code></p>");
  });

  it("renders a link with a safe href", () => {
    expect(render("[docs](https://example.com/x)")).toBe(
      `<p><a href="https://example.com/x" target="_blank" rel="noopener">docs</a></p>`,
    );
  });
});

describe("renderMarkdown with a hostile body", () => {
  it("escapes markup rather than emitting it", () => {
    const got = render('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
    expect(got).not.toContain("<script>");
    expect(got).not.toContain("<img");
    expect(got).toContain("&lt;script&gt;");
  });

  it("refuses a javascript: link, leaving the source text", () => {
    const got = render("[click](javascript:alert(1))");
    expect(got).not.toContain("<a href");
    expect(got).toContain("javascript:alert(1)");
  });

  it("refuses a data: link", () => {
    expect(render("[x](data:text/html,<script>alert(1)</script>)")).not.toContain("<a href");
  });

  it("cannot break out of a link href", () => {
    const got = render('[x](https://e.com/"onmouseover="alert(1))');
    expect(got).not.toContain(`"onmouseover="`);
  });

  it("cannot inject an attribute through a wiki link", () => {
    const got = render('[[a"onmouseover="b]]');
    expect(got).not.toContain(`"onmouseover="`);
  });

  it("escapes a hostile table cell", () => {
    const got = render("| a |\n| --- |\n| <b>x</b> |");
    expect(got).toContain("<td>&lt;b&gt;x&lt;/b&gt;</td>");
  });
});

describe("MarkdownHelper", () => {
  it("exposes renderMarkdown to views as a SafeBuffer", () => {
    const html = MarkdownHelper.renderMarkdown("# hi");
    expect(html.htmlSafe).toBe(true);
    expect(html.toString()).toBe("<h1>hi</h1>");
  });
});

/**
 * Both cases below are differences `pnpm gate:markdown` found against ringo's
 * own renderer over the 8,776 RFC and story documents in the tasks tree — the
 * kind of thing a hand-written example set will not think to try.
 */
describe("differences the ringo gate found", () => {
  it("keeps a bullet that mentions a line separator inside the list", () => {
    // JavaScript's `.` excludes U+2028 where Go's excludes only "\n", so this
    // bullet failed to match and closed the list one item early.
    const html = String(renderMarkdown("- first\n- with\u2028separator\n- third"));

    expect(html).toBe("<ul><li>first</li><li>with\u2028separator</li><li>third</li></ul>");
  });

  it("escapes a wiki link's story id as Go's url.PathEscape does", () => {
    // `=` is legal unencoded in a path segment, and Go leaves it; only
    // `encodeURIComponent` percent-escapes it.
    const html = String(renderMarkdown("[[warning-count=0-had-warnings]]"));

    expect(html).toContain('href="/story/warning-count=0-had-warnings"');
  });
});
