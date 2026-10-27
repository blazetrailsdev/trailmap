require "test_helper"

class RepoScopeTest < ActiveSupport::TestCase
  setup do
    rfc!("0001-a")
    story!("t1", rfc_id: "0001-a", pr: "trails#12", paths: [ "packages/x.ts" ])
    story!("t2", rfc_id: "0001-a", pr: "trails#7", status: "done")
    story!("u1", rfc_id: "0001-a", pr: "tr_ils#3")
    story!("c1", rfc_id: "0001-a")
  end

  test "relations: a name's PRs, plus the PR-less stories for the content repo" do
    assert_equal 1, RepoScope.relations("trails").size
    assert_equal 2, RepoScope.relations("tasks").size
  end

  test "stories_for escapes LIKE wildcards in the name" do
    assert_equal %w[t1 t2], RepoScope.stories_for("trails").map(&:id).sort
    assert_equal %w[u1], RepoScope.stories_for("tr_ils").map(&:id)
    assert_equal %w[c1], RepoScope.stories_for("tasks").map(&:id)
  end

  test "pluck_scoped builds Scoped rows" do
    row = RepoScope.pluck_scoped(Story.where(id: "t1")).first
    assert_kind_of RepoScope::Scoped, row
    assert_equal [ "t1", "trails#12" ], [ row.id, row.pr ]
  end

  test "open_counts_by_repo counts open stories, case-insensitively" do
    assert_equal({ "trails" => 1, "Tasks" => 0, "tasks" => 1 }, RepoScope.open_counts_by_repo(%w[trails Tasks tasks]))
  end

  test "story_for answers only a story of this repository" do
    assert_equal "t1", RepoScope.story_for("trails", "t1").id
    assert_nil RepoScope.story_for("trails", "c1")
    assert_nil RepoScope.story_for("trails", "")
  end

  test "pr_refs_of is highest number first, without repeats" do
    stories = RepoScope.stories_for("trails")
    assert_equal %w[trails#12 trails#7], RepoScope.pr_refs_of(stories + stories)
  end

  test "pr_number" do
    assert_equal 7228, RepoScope.pr_number("trails#7228")
    assert_equal 0, RepoScope.pr_number("trails")
    assert_equal 0, RepoScope.pr_number("trails#x")
  end

  test "paths_for" do
    assert_equal [ "packages/x.ts" ], RepoScope.paths_for(RepoScope.stories_for("trails"))
  end

  test "events_for is newest first, scoped, windowed and limited" do
    now = Time.now.utc
    Event.create!(at: (now - 1.hour).iso8601(3), verb: "claim", story_id: "t1")
    Event.create!(at: (now - 2.hours).iso8601(3), verb: "new", story_id: "t2")
    Event.create!(at: (now - 1.hour).iso8601(3), verb: "claim", story_id: "c1")
    Event.create!(at: (now - 30.days).iso8601(3), verb: "old", story_id: "t1")
    stories = RepoScope.stories_for("trails")
    assert_equal %w[claim new], RepoScope.events_for(stories, 7, 10).map(&:verb)
    assert_equal %w[claim], RepoScope.events_for(stories, 7, 1).map(&:verb)
    assert_equal [], RepoScope.events_for([], 7, 10)
  end
end
