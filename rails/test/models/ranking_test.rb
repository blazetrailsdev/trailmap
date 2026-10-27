require "test_helper"

# The ready queue, ported from ../../test/models/ranking.test.ts case for case.
class RankingTest < ActiveSupport::TestCase
  setup do
    rfc!("0136-trailmap", title: "Trailmap")
    rfc!("0002-draft", status: "draft", title: "Draft")
  end

  # Seed a status without going through a save (no auto-close callback).
  def seed(id, rfc_id, status, **attrs)
    Story.create!(id: id, rfc_id: rfc_id, status: "draft", **attrs)
    Story.where(id: id).update_all(status: status)
  end

  def ids(stories) = stories.map(&:id)

  test "claimable returns ready stories under an active RFC" do
    seed("a", "0136-trailmap", "ready")
    seed("b", "0136-trailmap", "draft")
    assert_equal [ "a" ], ids(Story.claimable)
  end

  test "claimable is distinct from the enum-generated Story.ready scope" do
    seed("stale", "0002-draft", "ready")
    assert_equal 1, Story.ready.count
    assert_empty Story.claimable
  end

  test "claimable excludes a story whose dep is neither done nor closed" do
    seed("base", "0136-trailmap", "in-progress")
    seed("dependent", "0136-trailmap", "ready")
    StoryDep.create!(story_id: "dependent", depends_on_id: "base")
    assert_empty Story.claimable
    Story.where(id: "base").update_all(status: "closed")
    assert_equal [ "dependent" ], ids(Story.claimable)
  end

  test "claimable excludes a story whose RFC dep is still open" do
    seed("waits", "0136-trailmap", "ready")
    StoryRfcDep.create!(story_id: "waits", rfc_id: "0002-draft")
    assert_empty Story.claimable
    Rfc.where(id: "0002-draft").update_all(status: "closed")
    assert_equal [ "waits" ], ids(Story.claimable)
  end

  test "claimable orders lower N first, unprioritised last, ties in index order" do
    seed("none-one", "0136-trailmap", "ready")
    seed("p2", "0136-trailmap", "ready", priority: 2)
    seed("none-two", "0136-trailmap", "ready")
    seed("p1", "0136-trailmap", "ready", priority: 1)
    assert_equal %w[p1 p2 none-one none-two], ids(Story.claimable)
  end

  test "claimable scopes to one RFC when asked" do
    rfc!("0137-other")
    seed("here", "0136-trailmap", "ready")
    seed("there", "0137-other", "ready")
    assert_equal [ "there" ], ids(Story.claimable(rfc: "0137-other"))
  end

  test "the outline ranks the queue exactly as the index of records does" do
    seed("none-one", "0136-trailmap", "ready")
    seed("p2", "0136-trailmap", "ready", priority: 2)
    seed("p1", "0136-trailmap", "ready", priority: 1)
    seed("base", "0136-trailmap", "in-progress")
    seed("blocked-by-dep", "0136-trailmap", "ready", priority: 0)
    StoryDep.create!(story_id: "blocked-by-dep", depends_on_id: "base")
    seed("waits", "0136-trailmap", "ready")
    StoryRfcDep.create!(story_id: "waits", rfc_id: "0002-draft")
    seed("under-draft", "0002-draft", "ready")

    index = Story.ranking_index
    outline = Story.ranking_outline
    assert_equal %w[p1 p2 none-one], ids(Ranking.claimable_in(outline))
    assert_equal ids(Ranking.claimable_in(index)), ids(Ranking.claimable_in(outline))
    assert_equal index.stories.map { |s| [ s.id, s.rfc_id, s.status, s.priority ] },
                 outline.stories.map { |s| [ s.id, s.rfc_id, s.status, s.priority ] }
    assert_equal index.deps, outline.deps
    assert_equal index.rfc_deps, outline.rfc_deps
  end

  test "the outline builds no Story" do
    seed("one", "0136-trailmap", "ready")
    assert Story.ranking_outline.stories.none? { |s| s.is_a?(Story) }
  end

  test "ready_queue and bundle answer as the index of records does, with records" do
    seed("lead", "0136-trailmap", "ready", cluster: "c1", est_loc: 50, priority: 1)
    seed("mate", "0136-trailmap", "ready", cluster: "c1", est_loc: 100)
    seed("other", "0136-trailmap", "ready", cluster: "c2", est_loc: 10)
    seed("base", "0136-trailmap", "in-progress", cluster: "c1", est_loc: 10)
    seed("held", "0136-trailmap", "ready", cluster: "c1", est_loc: 20)
    StoryDep.create!(story_id: "held", depends_on_id: "base")
    seed("under-draft", "0002-draft", "ready", cluster: "c1", est_loc: 30)

    full = Story.ranking_index
    queue, = Story.ready_queue
    assert_equal Story.claimable(index: full).map(&:attributes), queue.map(&:attributes)
    assert queue.all?(Story)

    stories, _, reason = Story.bundle(max_loc: 700)
    assert_equal Story.next_bundle(index: full, max_loc: 700).map(&:attributes), stories.map(&:attributes)
    assert_equal %w[lead mate], ids(stories)
    assert_nil reason
  end

  test "the queue scopes to an RFC, and an empty bundle says why" do
    # The RFC first: `belongs_to :rfc` is required under Rails 8 defaults. The
    # TypeScript test seeds the story first, which only works because its
    # suite never boots the application that sets that default.
    rfc!("0004-other")
    seed("ours", "0136-trailmap", "ready", cluster: "c1", est_loc: 50)
    seed("theirs", "0004-other", "ready", cluster: "c1", est_loc: 50)
    assert_equal [ "ours" ], ids(Story.ready_queue(rfc: "0136-trailmap").first)
    assert_equal "none-within-budget", Story.bundle(max_loc: 10).last
    assert_equal "no-matching-stories", Story.bundle(max_loc: 700, cluster: "nope").last
  end

  test "ranking_rows serializes every story as the index of records does" do
    seed("full", "0136-trailmap", "claimed", title: "T", cluster: "c1", est_loc: 50, priority: 1, pr: "trailmap#7",
                                             assignee: "a", claim_at: "2026-09-01T00:00:00Z", updated_on: "2026-09-01",
                                             file_path: "rfcs/x.md")
    seed("bare", "0002-draft", "ready")
    StoryPath.create!(story_id: "full", path: "app/x.ts")
    full = Story.ranking_index
    rows = Story.ranking_rows
    assert rows.stories.none?(Story)
    assert_equal [ "full" ], ids(Ranking.list_filtered_in(rows, status: "claimed"))
    assert_equal StoryJson.serialize_all(full.stories, full).to_json, StoryJson.serialize_all(rows.stories, rows).to_json
  end

  test "next_bundle packs the highest-value same-cluster bundle within the budget" do
    seed("x", "0136-trailmap", "ready", cluster: "c1", est_loc: 300)
    seed("y", "0136-trailmap", "ready", cluster: "c1", est_loc: 400)
    seed("z", "0136-trailmap", "ready", cluster: "c2", est_loc: 100)
    assert_equal %w[x y], ids(Story.next_bundle(max_loc: 700))
  end

  test "next_bundle leads with the highest-priority story" do
    seed("lead", "0136-trailmap", "ready", cluster: "c1", est_loc: 50, priority: 1)
    seed("fat", "0136-trailmap", "ready", cluster: "c2", est_loc: 600)
    seed("mate", "0136-trailmap", "ready", cluster: "c1", est_loc: 100)
    assert_equal %w[lead mate], ids(Story.next_bundle(max_loc: 700))
  end

  test "next_bundle excludes unestimated stories from the unprioritised knapsack" do
    seed("sized", "0136-trailmap", "ready", cluster: "c1", est_loc: 100)
    seed("unsized", "0136-trailmap", "ready", cluster: "c1")
    assert_equal [ "sized" ], ids(Story.next_bundle(max_loc: 700))
  end

  test "an empty bundle reports why" do
    assert_equal "no-matching-stories", Ranking.empty_bundle_reason_in(Story.ranking_index)
    seed("big", "0136-trailmap", "ready", est_loc: 900)
    assert_equal "none-within-budget", Ranking.empty_bundle_reason_in(Story.ranking_index)
  end

  test "touching prefers an exact path over the looser tiers" do
    seed("exact", "0136-trailmap", "ready")
    seed("under", "0136-trailmap", "ready")
    StoryPath.create!(story_id: "exact", path: "app/models/story.ts")
    StoryPath.create!(story_id: "under", path: "app/models/rfc.ts")
    assert_equal [ "exact" ], ids(Story.touching("app/models/story.ts"))
    assert_equal %w[exact under], ids(Story.touching("app/models"))
  end

  test "touching skips terminal stories unless asked for all" do
    seed("shipped", "0136-trailmap", "done")
    StoryPath.create!(story_id: "shipped", path: "app/models/story.ts")
    assert_empty Story.touching("app/models/story.ts")
    assert_equal [ "shipped" ], ids(Story.touching("app/models/story.ts", all: true))
  end

  test "list_filtered filters by rfc, status and cluster, on the effective status" do
    seed("one", "0136-trailmap", "ready", cluster: "c1")
    seed("two", "0136-trailmap", "draft", cluster: "c1")
    seed("stale", "0002-draft", "ready")
    assert_equal [ "one" ], ids(Story.list_filtered(status: "ready"))
    assert_equal 2, Story.list_filtered(cluster: "c1").size
    assert_equal [ "stale" ], ids(Story.list_filtered(rfc: "0002-draft"))
    assert_equal %w[stale two], ids(Story.list_filtered(status: "draft"))
  end

  test "a resolved dep is done or closed and nothing else" do
    assert Ranking.dep_resolved?("done")
    assert Ranking.dep_resolved?("closed")
    assert_not Ranking.dep_resolved?("in-progress")
    assert_not Ranking.dep_resolved?(nil)
  end

  test "effective priority falls back from the story to its RFC, then Infinity" do
    Rfc.where(id: "0136-trailmap").update_all(priority: 5)
    seed("own", "0136-trailmap", "ready", priority: 1)
    seed("inherited", "0136-trailmap", "ready")
    seed("neither", "0002-draft", "ready")
    index = Story.ranking_index
    by = ->(id) { index.stories.find { |s| s.id == id } }
    assert_equal 1, Ranking.effective_priority(by.call("own"), index.rfc_priority)
    assert_equal 5, Ranking.effective_priority(by.call("inherited"), index.rfc_priority)
    assert_equal Float::INFINITY, Ranking.effective_priority(by.call("neither"), index.rfc_priority)
  end

  test "a same-RFC-priority tie breaks by which RFC has less left" do
    rfc!("0137-other", priority: 3)
    Rfc.where(id: "0136-trailmap").update_all(priority: 2)
    seed("busy", "0136-trailmap", "ready")
    seed("busy-two", "0136-trailmap", "ready")
    seed("borrowed", "0137-other", "ready", priority: 2)
    index = Story.ranking_index
    by = ->(id) { index.stories.find { |s| s.id == id } }
    assert_equal 0, Ranking.compare_priority(by.call("busy"), by.call("borrowed"), Ranking.priority_context(index))
    Rfc.where(id: "0137-other").update_all(priority: 2)
    ctx = Ranking.priority_context(Story.ranking_index)
    assert_operator Ranking.compare_priority(by.call("busy"), by.call("borrowed"), ctx), :>, 0
  end

  test "the knapsack packs the best total within the budget" do
    seed("a", "0136-trailmap", "ready", est_loc: 300)
    seed("b", "0136-trailmap", "ready", est_loc: 400)
    seed("c", "0136-trailmap", "ready", est_loc: 500)
    items = Story.ranking_index.stories
    assert_equal %w[a b], ids(Ranking.best_bundle(items, 700))
    assert_empty Ranking.best_bundle(items, 0)
    assert_empty Ranking.best_bundle([], 700)
  end

  test "a bundle totals, and flags overrunning its budget" do
    seed("only", "0136-trailmap", "ready", est_loc: 900)
    rows = Story.ranking_index.stories
    assert_equal({ total: 900, lead_exceeds_budget: true }, Ranking.summarize_bundle(rows, 700))
    assert_not Ranking.summarize_bundle(rows, 900)[:lead_exceeds_budget]
  end

  test "the index collects the association rows into maps, sorted (priority, id)" do
    seed("dependent", "0136-trailmap", "ready")
    seed("base", "0136-trailmap", "done")
    StoryDep.create!(story_id: "dependent", depends_on_id: "base")
    StoryRfcDep.create!(story_id: "dependent", rfc_id: "0002-draft")
    StoryPath.create!(story_id: "dependent", path: "app/models/story.ts")
    index = Story.ranking_index
    assert_equal [ "base" ], index.deps["dependent"]
    assert_equal [ "0002-draft" ], index.rfc_deps["dependent"]
    assert_equal [ "app/models/story.ts" ], index.paths["dependent"]
    assert_equal "draft", index.rfc_status["0002-draft"]
    assert_equal %w[base dependent], ids(index.stories)
  end

  test "the index sorts by priority then id" do
    seed("zebra", "0136-trailmap", "ready")
    seed("alpha", "0136-trailmap", "ready")
    seed("urgent", "0136-trailmap", "ready", priority: 1)
    assert_equal %w[urgent alpha zebra], ids(Story.ranking_index.stories)
  end
end
