require "test_helper"

# The display rule beside `EffectiveStatus.of`, ported from
# ../../test/models/shown-status.test.ts case for case.
class ShownStatusTest < ActiveSupport::TestCase
  test "shows a dep-held ready story as blocked, and nothing else" do
    assert_equal "blocked", EffectiveStatus.shown("active", "ready", true)
    assert_equal "ready", EffectiveStatus.shown("active", "ready", false)
    assert_equal "draft", EffectiveStatus.shown("draft", "ready", true)
    assert_equal "in-progress", EffectiveStatus.shown("active", "in-progress", true)
  end

  test "holds on a story dep neither done nor closed, and on an RFC dep not closed" do
    deps = { "s" => [ "d" ] }
    rfc_deps = { "r" => [ "0001" ] }
    assert Ranking.dep_held?("s", deps, rfc_deps, { "d" => "ready" }, {})
    assert_not Ranking.dep_held?("s", deps, rfc_deps, { "d" => "done" }, {})
    assert_not Ranking.dep_held?("s", deps, rfc_deps, { "d" => "closed" }, {})
    assert Ranking.dep_held?("r", deps, rfc_deps, {}, { "0001" => "active" })
    assert_not Ranking.dep_held?("r", deps, rfc_deps, {}, { "0001" => "closed" })
    assert_not Ranking.dep_held?("free", deps, rfc_deps, {}, {})
  end

  test "names every story of a snapshot that waits on a dep" do
    row = Struct.new(:id, :rfc_id, :status)
    index = Ranking::Index.new(
      stories: [ row.new("a", "x", "ready"), row.new("b", "x", "ready"), row.new("c", "x", "done") ],
      deps: { "a" => [ "b" ], "b" => [ "c" ] }, rfc_deps: {}, rfc_status: { "x" => "active" }
    )
    assert_equal [ "a" ], Ranking.dep_held_in(index).to_a
  end

  test "answers the held ones among the ids given, or across every story" do
    rfc!("0001-open")
    rfc!("0002-shut", status: "closed")
    %w[dep-open waits clear waits-rfc].each { |id| Story.create!(id: id, rfc_id: "0001-open", status: "ready") }
    Story.create!(id: "dep-done", rfc_id: "0001-open", status: "draft")
    Story.where(id: "dep-done").update_all(status: "done")
    StoryDep.create!(story_id: "waits", depends_on_id: "dep-open")
    StoryDep.create!(story_id: "clear", depends_on_id: "dep-done")
    StoryRfcDep.create!(story_id: "waits-rfc", rfc_id: "0001-open")
    StoryRfcDep.create!(story_id: "clear", rfc_id: "0002-shut")
    assert_equal [ "waits" ], Story.dep_held_ids(%w[waits clear]).to_a
    assert_equal %w[waits waits-rfc], Story.dep_held_ids.to_a.sort
    assert_empty Story.dep_held_ids([])
  end
end
