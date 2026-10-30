# `/search` — stories and RFCs whose id, title or body mention a phrase.
#
# Ids, titles and bodies are columns, matched with Arel `matches`. `ingest`
# writes each body with its frontmatter stripped.
# Tiers: 0 id is the phrase, 1 title starts with
# it, 2 id or title contains it, 3 only the body does.
module Search
  MIN_LENGTH = 2
  MAX_LENGTH = 100
  SNIPPET_CONTEXT = 80

  Hit = Struct.new(:kind, :id, :title, :status, :rfc_id, :tier, :mentions, :file_path, :snippet, keyword_init: true)
  Row = Struct.new(:kind, :id, :title, :status, :rfc_id, :file_path, keyword_init: true)

  module_function

  # The phrase a request means, trimmed and bounded; nil when too short.
  def phrase(param)
    return nil unless param.is_a?(String)
    phrase = param.strip.gsub(/\s+/, " ")[0, MAX_LENGTH].strip
    phrase.length < MIN_LENGTH ? nil : phrase
  end

  def search(phrase)
    needle = phrase.downcase
    titled = title_matches(phrase)
    mentioned = body_mentions(phrase)
    hits = all_rows.filter_map do |row|
      key = "#{row.kind}:#{row.id}"
      mentions = mentioned.fetch(key, 0)
      tier =
        if row.id.downcase == needle then 0
        elsif row.title.to_s.downcase.start_with?(needle) && titled.include?(key) then 1
        elsif titled.include?(key) then 2
        elsif mentions.positive? then 3
        end
      next if tier.nil?
      Hit.new(kind: row.kind, id: row.id, title: row.title || row.id, status: row.status, rfc_id: row.rfc_id,
              tier: tier, mentions: mentions, file_path: row.file_path, snippet: "")
    end
    hits.sort { |a, b| compare(a, b) }
  end

  def compare(a, b)
    return a.tier <=> b.tier if a.tier != b.tier
    return b.mentions <=> a.mentions if a.mentions != b.mentions
    return a.kind == "rfc" ? -1 : 1 if a.kind != b.kind
    a.id <=> b.id
  end

  # `hits` with snippets read from the files, as written. Only the page shown.
  def with_snippets(hits, phrase)
    needle = phrase.downcase
    hits.map do |hit|
      next hit if hit.mentions.zero?
      hit.dup.tap { |h| h.snippet = snippet_of(Document.read(hit.file_path).markdown, needle) }
    end
  end

  def title_matches(phrase)
    pattern = "%#{Story.sanitize_sql_like(phrase.downcase)}%"
    { "story" => Story, "rfc" => Rfc }.flat_map do |kind, model|
      t = model.arel_table
      condition = t[:title].lower.matches(pattern, "\\").or(t[:id].lower.matches(pattern, "\\"))
      model.where(condition).pluck(:id).map { |id| "#{kind}:#{id}" }
    end.to_set
  end

  def all_rows
    rfcs = Rfc.pluck(:id, :title, :status, :file_path).map do |id, title, status, file_path|
      Row.new(kind: "rfc", id: id, title: title, status: status, rfc_id: nil, file_path: file_path)
    end
    stories = Story.pluck(:id, :title, :status, :rfc_id, :file_path).map do |id, title, status, rfc_id, file_path|
      Row.new(kind: "story", id: id, title: title, status: status, rfc_id: rfc_id, file_path: file_path)
    end
    rfcs + stories
  end

  # Mentions of the phrase per `kind:id`. SQL picks the bodies that have any;
  # they are counted here, for this one search, and nothing is kept.
  def body_mentions(phrase)
    needle = phrase.downcase
    pattern = "%#{Story.sanitize_sql_like(needle)}%"
    { "story" => Story, "rfc" => Rfc }.each_with_object({}) do |(kind, model), mentions|
      condition = model.arel_table[:body].matches(pattern, "\\")
      model.where(condition).pluck(:id, :body).each do |id, body|
        mentions["#{kind}:#{id}"] = body.downcase.scan(needle).size
      end
    end
  end

  def snippet_of(text, needle)
    at = text.downcase.index(needle)
    return "" if at.nil?
    start = [ 0, at - SNIPPET_CONTEXT ].max
    finish = [ text.length, at + needle.length + SNIPPET_CONTEXT ].min
    shown = text[start...finish].gsub(/\s+/, " ").strip
    "#{start.positive? ? '…' : ''}#{shown}#{finish < text.length ? '…' : ''}"
  end
end
