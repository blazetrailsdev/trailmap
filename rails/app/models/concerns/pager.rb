# Where one page sits in a list, for any list served a page at a time.
# `shared/_pager` draws it.
Pager = Struct.new(:page, :pages, :total, :from, :to, :prev_href, :next_href, keyword_init: true) do
  # The page a request means. Digits only; anything else is the first page.
  def self.requested_page(param)
    param.is_a?(String) && param.match?(/\A\d+\z/) ? param.to_i : 1
  end

  # A page past the end is the last page, not an empty one.
  def self.for(total, size, requested, &href_for)
    pages = [ 1, (total.to_f / size).ceil ].max
    page = requested.clamp(1, pages)
    first = (page - 1) * size
    new(page: page, pages: pages, total: total,
        from: total.zero? ? 0 : first + 1, to: [ first + size, total ].min,
        prev_href: page > 1 ? href_for.call(page - 1) : nil,
        next_href: page < pages ? href_for.call(page + 1) : nil)
  end
end
