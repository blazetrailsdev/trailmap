# Which stories belong to a repository, and the ONE place that decides it.
#
# - A story whose `pr` is `<name>#N` belongs to `<name>`.
# - A story with NO pr belongs to the content repo, `tasks`.
#
# Scoped by bare name, not owner: `stories.pr` carries no owner, which is why
# `Repository` names are unique across owners. The TypeScript original
# (../../../app/models/concerns/repo-scope.ts) has the long argument.
module RepoScope
  CONTENT_REPO = "tasks"

  COLUMNS = %i[id rfc_id status pr title assignee priority est_loc].freeze
  # Plucked, not loaded: trails scopes to ~9,000 stories.
  Scoped = Struct.new(*COLUMNS, keyword_init: true)
  ScopedEvent = Struct.new(:at, :verb, :story_id, :pr, :actor, keyword_init: true)

  # How many ids go into one `IN (…)` — a guard against growth.
  BIND_CHUNK = 900

  module_function

  # The relations the scope rule selects. Rails' `sanitize_sql_like` escapes
  # `_` and `%`, which are legal in a repository name.
  def relations(repo)
    rels = [ Story.where("pr LIKE ? ESCAPE '\\'", "#{Story.sanitize_sql_like(repo)}#%") ]
    rels << Story.where(pr: nil) if repo == CONTENT_REPO
    rels
  end

  def stories_for(repo)
    relations(repo).flat_map { |rel| pluck_scoped(rel) }
  end

  # Open stories per repository, in ONE grouped query keyed by the scope rule.
  def open_counts_by_repo(repos)
    counted = Story.where.not(status: %w[done closed])
                   .group(Arel.sql("lower(substr(pr, 1, instr(pr, '#') - 1))"))
                   .count
    repos.index_with do |repo|
      counted.fetch(repo.downcase, 0) + (repo == CONTENT_REPO ? counted.fetch(nil, 0) : 0)
    end
  end

  def pluck_scoped(relation)
    relation.pluck(*COLUMNS).map { |row| Scoped.new(**COLUMNS.zip(row).to_h) }
  end

  # One story, IF it belongs to this repository.
  def story_for(repo, id)
    return nil if id.blank?
    relations(repo).each do |rel|
      found = pluck_scoped(rel.where(id: id)).first
      return found if found
    end
    nil
  end

  # The `pr` values seen on these stories, highest number first.
  def pr_refs_of(stories)
    StableSort.sort(stories.filter_map(&:pr).uniq) { |a, b| pr_number(b) <=> pr_number(a) }
  end

  # `trails#7228` → 7228, and 0 for anything that is not one.
  def pr_number(ref)
    at = ref.index("#")
    return 0 if at.nil?
    Integer(ref[(at + 1)..], 10)
  rescue ArgumentError
    0
  end

  def paths_for(stories)
    stories.map(&:id).each_slice(BIND_CHUNK).flat_map { |chunk| StoryPath.where(story_id: chunk).pluck(:path) }
  end

  # The repo's events inside a time window, newest first — bounded by TIME
  # (indexed) and filtered to the scope in memory.
  def events_for(stories, window_days, limit)
    return [] if stories.empty?
    mine = stories.to_set(&:id)
    since = (Time.now.utc - window_days.days).iso8601(3)
    out = []
    Event.where("at >= ?", since).order(at: :desc).pluck(:at, :verb, :story_id, :pr, :actor).each do |at, verb, story_id, pr, actor|
      next unless story_id && mine.include?(story_id)
      out << ScopedEvent.new(at: at, verb: verb, story_id: story_id, pr: pr, actor: actor)
      break if out.size == limit
    end
    out
  end
end
