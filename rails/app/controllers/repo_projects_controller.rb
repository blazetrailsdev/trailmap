# `/:owner/:repo/projects` — the RFCs this repo's work belongs to, with the
# RFC's OWN counts, decided by RfcProgress as everywhere else.
class RepoProjectsController < RepoController
  self.tab = "projects"

  Row = Struct.new(:id, :title, :status, :priority, :counts, :bar, :mine, keyword_init: true)
  Column = Struct.new(:status, :stories, keyword_init: true)
  Item = Struct.new(:id, :title)

  COLUMN_ORDER = %w[ready claimed in-progress done blocked closed draft].freeze

  def index
    stories = RepoScope.stories_for(@repo.name)
    rfc_ids = stories.to_set(&:rfc_id)
    statuses = Story.pluck(:rfc_id, :status).group_by(&:first).transform_values { |v| v.map(&:last) }
    mine = stories.map(&:rfc_id).tally
    rows = Rfc.all.select { |r| rfc_ids.include?(r.id) }.map do |rfc|
      own = statuses.fetch(rfc.id, [])
      Row.new(id: rfc.id, title: rfc.title || rfc.id, status: rfc.status, priority: rfc.priority,
              counts: RfcProgress.story_counts(own), bar: RfcProgress.status_counts(own, rfc.status), mine: mine.fetch(rfc.id, 0))
    end
    @rows = by_priority_then_id(rows)
  end

  def show
    @id = params[:id].to_s
    @rfc = @id.empty? ? nil : Rfc.find_by(id: @id)
    mine = RepoScope.stories_for(@repo.name).select { |s| s.rfc_id == @id }
    @columns = COLUMN_ORDER.filter_map do |status|
      items = mine.select { |s| s.status == status }.map { |s| Item.new(s.id, s.title || s.id) }
      Column.new(status: status, stories: items) if items.any?
    end
    render status: @rfc.nil? ? :not_found : :ok
  end
end
