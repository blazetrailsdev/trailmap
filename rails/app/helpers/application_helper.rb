module ApplicationHelper
  # The pages each header link's section holds besides the paths under its
  # own; the trails app's `navMark` reads the same file.
  HEADER_SECTIONS = JSON.parse(File.read(Rails.root.join("config/header-sections.json"))).freeze

  # How a header link is marked: "page" on an exact match, "section" on a
  # page inside the link's section, else nil. `current` defaults to the
  # request's path, and then, as `current_page?` does, only a GET or HEAD is
  # marked. Both sides are unescaped before comparing.
  def nav_mark(path, current = nil)
    if current.nil?
      return nil unless request.get? || request.head?
      current = request.path
    end
    strip = ->(value) { value.length > 1 ? value.sub(%r{/+\z}, "") : value }
    target = strip.(URI::RFC2396_PARSER.unescape(path))
    here = strip.(URI::RFC2396_PARSER.unescape(current))
    return "page" if here == target
    extra = HEADER_SECTIONS[target]
    prefixes = ["#{target}/", *(extra.is_a?(Array) ? extra : [])]
    prefixes.any? { |prefix| here.start_with?(prefix) } ? "section" : nil
  end

  # The PR a preview app serves (TRAILMAP_PREVIEW), for the layout's banner;
  # nil in a real deployment. The trails app's `previewPr` (config/preview.ts).
  def preview_pr
    raw = Rails.configuration.x.preview.pr.to_s.strip
    pr = Integer(raw, 10, exception: false)
    pr if pr&.positive? && pr.to_s == raw
  end

  # The word a status badge shows, and the suffix of its `s-` class. Blank is
  # `unknown`, ringo's arm for a dep whose RFC is missing.
  def status_word(status)
    status.to_s.strip.presence || "unknown"
  end

  # A number as JavaScript prints it: `50`, never Ruby's `50.0`. The `.tse`
  # views interpolate numbers straight into widths and labels, so the same
  # value has to print the same way here.
  def js_num(value)
    return value unless value.is_a?(Float)
    value == value.truncate ? value.to_i.to_s : value.to_s
  end
end
