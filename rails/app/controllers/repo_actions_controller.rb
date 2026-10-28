# `/:owner/:repo/actions` — the run log this domain has: the `events` table,
# newest first, inside a stated window.
class RepoActionsController < RepoController
  self.tab = "actions"

  RUN_LIMIT = 100
  WINDOW_DAYS = 90

  Row = Struct.new(:at, :verb, :story_id, :story_title, :pr, :actor, keyword_init: true)

  def index
    stories = RepoScope.stories_for(@repo.name)
    titles = stories.to_h { |s| [ s.id, s.title || s.id ] }
    @limit = RUN_LIMIT
    @window_days = WINDOW_DAYS
    @rows = RepoScope.events_for(stories, WINDOW_DAYS, RUN_LIMIT).map do |e|
      Row.new(at: e.at, verb: e.verb, story_id: e.story_id, story_title: e.story_id && titles[e.story_id],
              pr: e.pr, actor: e.actor)
    end
  end
end
