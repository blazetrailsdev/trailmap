# A small, dependency-free markdown renderer for the story and RFC pages — a
# port of btwhooks' core/markdown.go, construct for construct, by way of
# ../../../app/helpers/markdown-helper.ts. Body text is untrusted and escaped;
# only the tags emitted here are trusted.
module MarkdownHelper
  HEADER_RE = /\A(\#{1,6})\s+(.*?)\s*#*\z/m
  BULLET_RE = /\A[ \t]*[-*+]\s+(.*)\z/m
  ORDERED_RE = /\A[ \t]*\d+\.\s+(.*)\z/m
  LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/
  WIKI_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/
  BOLD_RE = /\*\*([^*]+?)\*\*/
  ITALIC_RE = /\*([^*\s][^*]*?)\*/
  TABLE_SEP_RE = /\A\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*\z/
  # What Go's `url.PathEscape` leaves alone.
  GO_PATH_UNRESERVED = /[A-Za-z0-9\-_.~$&+:=@]/

  def render_markdown(src)
    lines = src.to_s.gsub("\r\n", "\n").split("\n", -1)
    out = +""
    i = 0
    while i < lines.size
      line = lines[i]
      trimmed = line.strip
      if trimmed.empty?
        i += 1
      elsif trimmed.start_with?("```", "~~~")
        fence = trimmed[0, 3]
        i += 1
        code = []
        while i < lines.size && !lines[i].strip.start_with?(fence)
          code << lines[i]
          i += 1
        end
        i += 1
        out << "<pre><code>" << md_escape(code.join("\n")) << "</code></pre>"
      elsif trimmed.start_with?("<!--")
        i += 1 while i < lines.size && !lines[i].include?("-->")
        i += 1
      elsif (m = HEADER_RE.match(line))
        n = m[1].length
        out << "<h#{n}>" << md_inline(m[2]) << "</h#{n}>"
        i += 1
      elsif %w[--- *** ___].include?(trimmed)
        out << "<hr>"
        i += 1
      elsif trimmed.start_with?(">")
        quote = []
        while i < lines.size && lines[i].strip.start_with?(">")
          quote << lines[i].strip[1..].strip
          i += 1
        end
        out << "<blockquote>" << md_inline(quote.join(" ")) << "</blockquote>"
      elsif BULLET_RE.match?(line) || ORDERED_RE.match?(line)
        ordered = ORDERED_RE.match?(line)
        tag = ordered ? "ol" : "ul"
        re = ordered ? ORDERED_RE : BULLET_RE
        out << "<#{tag}>"
        while i < lines.size && (m = re.match(lines[i]))
          out << "<li>" << md_inline(m[1]) << "</li>"
          i += 1
        end
        out << "</#{tag}>"
      elsif line.include?("|") && i + 1 < lines.size && TABLE_SEP_RE.match?(lines[i + 1])
        headers = md_table_row(line)
        aligns = md_table_aligns(lines[i + 1], headers.size)
        i += 2
        rows = []
        while i < lines.size && !lines[i].strip.empty? && lines[i].include?("|")
          rows << md_table_row(lines[i])
          i += 1
        end
        out << "<table><thead><tr>"
        headers.each_with_index { |h, c| out << "<th#{md_align(aligns, c)}>" << md_inline(h) << "</th>" }
        out << "</tr></thead><tbody>"
        rows.each do |row|
          out << "<tr>"
          headers.size.times { |c| out << "<td#{md_align(aligns, c)}>" << md_inline(row[c] || "") << "</td>" }
          out << "</tr>"
        end
        out << "</tbody></table>"
      else
        para = []
        while i < lines.size && !lines[i].strip.empty? && !md_block_start?(lines[i])
          para << lines[i]
          i += 1
        end
        out << "<p>" << md_inline(para.join(" ")) << "</p>"
      end
    end
    out.html_safe
  end

  private

  def md_block_start?(line)
    t = line.strip
    return true if t.start_with?("```", "~~~", "<!--", ">") || %w[--- *** ___].include?(t)
    HEADER_RE.match?(line) || BULLET_RE.match?(line) || ORDERED_RE.match?(line)
  end

  def md_table_row(line)
    s = line.strip
    s = s[1..] if s.start_with?("|")
    s = s[0...-1] if s.end_with?("|")
    s.split("|", -1).map(&:strip)
  end

  def md_table_aligns(sep, n)
    cells = md_table_row(sep)
    Array.new(n) do |i|
      c = cells[i] or next ""
      left = c.start_with?(":")
      right = c.end_with?(":")
      if left && right then "center" elsif right then "right" elsif left then "left" else "" end
    end
  end

  def md_align(aligns, c)
    aligns[c].present? ? %( style="text-align:#{aligns[c]}") : ""
  end

  # Code spans first, their contents escaped and otherwise verbatim.
  def md_inline(input)
    s = input
    out = +""
    loop do
      i = s.index("`")
      j = i && s.index("`", i + 1)
      if j.nil?
        out << md_inline_text(s)
        break
      end
      out << md_inline_text(s[0...i]) << "<code>" << md_escape(s[(i + 1)...j]) << "</code>"
      s = s[(j + 1)..]
    end
    out
  end

  def md_inline_text(input)
    s = md_escape(input)
    s = s.gsub(WIKI_RE) do
      raw_id = $1
      raw_label = $2
      label = raw_label.to_s.strip.empty? ? raw_id : raw_label
      %(<a href="/story/#{md_path_escape(md_unescape(raw_id).strip)}">#{label}</a>)
    end
    s = s.gsub(LINK_RE) do
      md_safe_url?(md_unescape($2)) ? %(<a href="#{$2}" target="_blank" rel="noopener">#{$1}</a>) : $&
    end
    s.gsub(BOLD_RE, '<strong>\1</strong>').gsub(ITALIC_RE, '<em>\1</em>')
  end

  def md_escape(s)
    ERB::Util.html_escape(s).to_str
  end

  def md_unescape(s)
    s.gsub("&lt;", "<").gsub("&gt;", ">").gsub("&quot;", '"').gsub("&#39;", "'").gsub("&amp;", "&")
  end

  # Go's `url.PathEscape`, not `CGI.escape`.
  def md_path_escape(id)
    id.each_char.map do |ch|
      GO_PATH_UNRESERVED.match?(ch) ? ch : ch.bytes.map { |b| format("%%%02X", b) }.join
    end.join
  end

  def md_safe_url?(u)
    l = u.strip.downcase
    l.start_with?("http://", "https://", "mailto:", "/", "#")
  end
end
