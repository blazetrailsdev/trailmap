# The tasks database's half of the dashboard's sessions (RFC 0232): which
# stories a PR closes, the stage an agent reported for its story, and the
# stories the palette finds. Every status, so a merged session keeps its
# now-done stories.
module FleetStories
  MAX_REFS = 100
  MAX_HITS = 20
  COLUMNS = %i[id title status rfc_id stage].freeze

  module_function

  def as_story(row)
    id, title, status, rfc, stage = row
    { id: id, title: title || id, status: status, rfc: rfc, stage: stage }
  end

  # `repo#N` refs to their stories, by id; an empty list for a ref nothing names.
  def for_prs(refs)
    answer = refs.to_h { |ref| [ ref, [] ] }
    return answer if refs.empty?
    Story.where(pr: refs).order(:id).pluck(*COLUMNS, :pr).each { |row| answer[row.last]&.push(as_story(row.first(5))) }
    answer
  end

  # Story ids to themselves, for a spawn that has no PR yet; nil for an id nothing names.
  def for_ids(ids)
    answer = ids.to_h { |id| [ id, nil ] }
    return answer if ids.empty?
    Story.where(id: ids).pluck(*COLUMNS).each { |row| answer[row.first] = as_story(row) }
    answer
  end

  # Stories whose id or title contains `phrase`, at most MAX_HITS: an id match
  # first, then a title that starts with it, then the rest, each by id.
  def matching(phrase)
    needle = phrase.downcase
    pattern = "%#{Story.sanitize_sql_like(needle)}%"
    table = Story.arel_table
    condition = table[:title].lower.matches(pattern, "\\").or(table[:id].lower.matches(pattern, "\\"))
    rows = Story.where(condition).order(:id).pluck(*COLUMNS)
    tier = ->(row) { row[0].downcase.include?(needle) ? 0 : (row[1] || "").downcase.start_with?(needle) ? 1 : 2 }
    StableSort.sort(rows) { |a, b| tier.(a) <=> tier.(b) }.first(MAX_HITS).map { |row| as_story(row) }
  end
end
