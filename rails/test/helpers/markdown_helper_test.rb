require "test_helper"

# Ported from ../../test/helpers/markdown-helper.test.ts. The renderer is a
# port of ringo's, so these hold the exact bytes.
class MarkdownHelperTest < ActionView::TestCase
  def render_md(src) = render_markdown(src).to_str

  test "wiki links, labelled and path-escaped as Go's url.PathEscape" do
    assert_includes render_md("see [[story-foo-12]] for context"), %(<a href="/story/story-foo-12">story-foo-12</a>)
    assert_includes render_md("blocked by [[story-bar-3|the auth work]]"), %(<a href="/story/story-bar-3">the auth work</a>)
    assert_includes render_md("[[story a/b]]"), %(<a href="/story/story%20a%2Fb">story a/b</a>)
    assert_includes render_md("[[a=b!]]"), %(<a href="/story/a=b%21">)
  end

  test "tables: header, alignment, body, padding" do
    got = render_md("| Name | Count |\n| ---- | ----: |\n| `a` | 1 |\n| b | 2 |")
    [ "<th>Name</th>", %(<th style="text-align:right">Count</th>), "<td><code>a</code></td>",
      %(<td style="text-align:right">1</td>), "<td>b</td>" ].each { |want| assert_includes got, want }
    got = render_md("| a | b |\n| :--- | :--: |\n| 1 | 2 |")
    assert_includes got, %(<th style="text-align:left">a</th>)
    assert_includes got, %(<th style="text-align:center">b</th>)
    assert_includes render_md("| a | b |\n| --- | --- |\n| 1 |"), "<td>1</td><td></td>"
    assert_not_includes render_md("use a | b for the union"), "<table>"
  end

  test "blocks" do
    assert_equal "<h2>Context</h2>", render_md("## Context")
    assert_equal "<h6>deep</h6>", render_md("###### deep ######")
    assert_equal "<pre><code>if a &lt; b {\n}</code></pre>", render_md("```go\nif a < b {\n}\n```")
    assert_equal "<ul><li>one</li><li>two</li></ul>", render_md("- one\n- two")
    assert_equal "<ol><li>one</li><li>two</li></ol>", render_md("1. one\n2. two")
    assert_equal "<blockquote>first second</blockquote>", render_md("> first\n> second")
    %w[--- *** ___].each { |rule| assert_equal "<hr>", render_md(rule) }
    assert_equal "<p>one two</p><h2>next</h2>", render_md("one\ntwo\n## next")
    assert_equal "<p>body</p>", render_md("<!-- comments: 3 -->\nbody")
    assert_equal "<p>body</p>", render_md("<!-- a\nb -->\nbody")
  end

  test "inline" do
    assert_equal "<p>a <code>x &lt; y</code> b <strong>bold</strong> c <em>italic</em> d</p>",
                 render_md("a `x < y` b **bold** c *italic* d")
    assert_equal "<p><code>**not bold**</code></p>", render_md("`**not bold**`")
    assert_equal %(<p><a href="https://example.com/x" target="_blank" rel="noopener">docs</a></p>),
                 render_md("[docs](https://example.com/x)")
  end

  test "a bullet mentioning LINE SEPARATOR stays one list, as in Go" do
    assert_equal "<ul><li>a b</li><li>c</li></ul>", render_md("- a b\n- c")
  end

  test "a hostile body is escaped, never emitted" do
    got = render_md(%(<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>))
    assert_not_includes got, "<script>"
    assert_not_includes got, "<img"
    assert_not_includes render_md("[click](javascript:alert(1))"), "<a href"
    assert_not_includes render_md("[x](data:text/html,<script>alert(1)</script>)"), "<a href"
    assert_not_includes render_md(%([x](https://e.com/"onmouseover="alert(1)))), %("onmouseover=")
    assert_not_includes render_md(%([[a"onmouseover="b]])), %("onmouseover=")
    assert_includes render_md("| a |\n| --- |\n| <b>x</b> |"), "<td>&lt;b&gt;x&lt;/b&gt;</td>"
  end

  test "answers a SafeBuffer" do
    assert render_markdown("# hi").html_safe?
  end
end
