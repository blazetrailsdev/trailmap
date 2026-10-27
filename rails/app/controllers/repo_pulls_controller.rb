# `/:owner/:repo/pulls` — the repo's PRs as the task domain records them:
# grouped from `stories.pr`. "Merged" means every story under it is resolved.
class RepoPullsController < RepoController
  self.tab = "pulls"

  Row = Struct.new(:ref, :number, :href, :stories, :merged, keyword_init: true)
  Item = Struct.new(:id, :title, :status, keyword_init: true)

  def index
    stories = RepoScope.stories_for(@repo.name)
    by_ref = RepoScope.pr_refs_of(stories).to_h do |ref|
      [ ref, Row.new(ref: ref, number: RepoScope.pr_number(ref), href: github_pull(RepoScope.pr_number(ref)), stories: [], merged: true) ]
    end
    stories.each do |s|
      row = s.pr && by_ref[s.pr] or next
      row.stories << Item.new(id: s.id, title: s.title || s.id, status: s.status)
      row.merged = false unless closed_status?(s.status)
    end
    rows = by_ref.values
    @state = params[:state] == "merged" ? "merged" : "open"
    @tab_counts = { open: rows.count { |r| !r.merged }, merged: rows.count(&:merged) }
    @rows = rows.select { |r| @state == "merged" ? r.merged : !r.merged }
  end

  def show
    @number = js_number(params[:id].to_s)
    @ref = "#{@repo.name}##{@number}"
    @href = github_pull(@number)
    @stories = RepoScope.stories_for(@repo.name).select { |s| s.pr == @ref }
                        .map { |s| Item.new(id: s.id, title: s.title || s.id, status: s.status) }
    render status: @stories.empty? ? :not_found : :ok
  end

  private

  def github_pull(number)
    "https://github.com/#{@nwo}/pull/#{number}"
  end

  # JavaScript's `Number(s)` as it prints: digits are an integer, junk NaN.
  def js_number(s)
    return 0 if s.strip.empty?
    Integer(s.strip, 10)
  rescue ArgumentError
    "NaN"
  end
end
