# `/search?q=` — stories and RFCs by id, title and body (Search has the
# matching and ranking), paged like the backlog.
class SearchesController < ApplicationController
  PAGE_SIZE = 50

  def show
    raw = params[:q]
    @asked = raw.is_a?(String) ? raw.strip : ""
    @phrase = Search.phrase(raw)
    hits = @phrase.nil? ? [] : Search.search(@phrase)
    @pager = Pager.for(hits.size, PAGE_SIZE, Pager.requested_page(params[:page])) do |page|
      "/search?q=#{ERB::Util.url_encode(@phrase.to_s)}&page=#{page}"
    end
    @hits = Search.with_snippets(hits[(@pager.from.zero? ? 0 : @pager.from - 1)...@pager.to], @phrase.to_s)
    @too_short = !@asked.empty? && @phrase.nil?
    @min_length = Search::MIN_LENGTH
    @max_length = Search::MAX_LENGTH
  end
end
