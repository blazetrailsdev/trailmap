# `/:owner/:repo/pulse` — the Insights tab: stories by status, the estimate
# outstanding, and what moved in the last 30 days.
class RepoInsightsController < RepoController
  self.tab = "insights"

  WINDOW_DAYS = 30

  Count = Struct.new(:key, :count)

  def show
    stories = RepoScope.stories_for(@repo.name)
    recent = RepoScope.events_for(stories, WINDOW_DAYS, Float::INFINITY)
    by_status = stories.map(&:status).tally
    @window_days = WINDOW_DAYS
    @story_count = stories.size
    @open_estimate = stories.reject { |s| %w[done closed].include?(s.status) }.sum { |s| s.est_loc || 0 }
    @statuses = Story::STATUSES.map { |s| Count.new(s, by_status.fetch(s, 0)) }.select { |r| r.count.positive? }
    @verbs = StableSort.sort(recent.map(&:verb).tally.map { |verb, count| Count.new(verb, count) }) do |a, b|
      (b.count <=> a.count).nonzero? || LocaleCompare.compare(a.key, b.key)
    end
    @recent_count = recent.size
    @done_count = recent.count { |e| e.verb == "done" }
  end
end
