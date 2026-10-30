# `/:owner/:repo/issues` — the repo's stories, Open and Closed as GitHub
# counts them. Ordered and counted WHOLE, then cut to a page.
class RepoIssuesController < RepoController
  self.tab = "issues"

  PAGE_SIZE = 100

  Row = Struct.new(:id, :title, :status, :rfc_id, :pr, :assignee, :est_loc, :priority, keyword_init: true)

  def index
    stories = RepoScope.stories_for(@repo.name)
    open, closed = stories.partition { |s| !closed_status?(s.status) }
    @state = params[:state] == "closed" ? "closed" : "open"
    shown = by_priority_then_id(@state == "closed" ? closed : open)
    @pager = Pager.for(shown.size, PAGE_SIZE, Pager.requested_page(params[:page])) do |page|
      repo_issues_path(@owner.login, @repo.name, state: @state, page: page)
    end
    @tab_counts = { open: open.size, closed: closed.size }
    @rows = shown[(@pager.from.zero? ? 0 : @pager.from - 1)...@pager.to].map { |s| row_of(s) }
  end

  # SCOPED: a story of another repository is a 404 here.
  def show
    @id = params[:id].to_s
    story = RepoScope.story_for(@repo.name, @id)
    @row = story && row_of(story)
    render status: story.nil? ? :not_found : :ok
  end

  private

  def row_of(s)
    Row.new(id: s.id, title: s.title || s.id, status: s.status, rfc_id: s.rfc_id, pr: s.pr,
            assignee: s.assignee, est_loc: s.est_loc, priority: s.priority)
  end
end
