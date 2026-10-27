# The coder of the JSON array columns (`packages`, `clusters`,
# `related_rfcs`): `[]` for null and for anything unparseable. `ingest`
# writes these as text, and a strict coder would take a page down over a
# column nothing renders.
module JsonArray
  def self.load(value)
    return [] if value.blank?
    parsed = JSON.parse(value)
    parsed.is_a?(Array) ? parsed : []
  rescue JSON::ParserError
    []
  end

  def self.dump(value)
    JSON.generate(value || [])
  end
end
