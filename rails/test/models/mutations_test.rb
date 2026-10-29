require "test_helper"

# The mutation verbs' guards, ported from ../../test/models/mutations.test.ts.
class MutationsTest < ActiveSupport::TestCase
  setup do
    rfc!("0136-trailmap", title: "Trailmap")
    story!("s1", rfc_id: "0136-trailmap", est_loc: 10)
    story!("s2", rfc_id: "0136-trailmap", est_loc: 20)
  end

  def find(id) = Story.find(id)

  test "claim wins once and reports the loser as a benign conflict" do
    Story.claim_all([ "s1" ], "agent-a")
    error = assert_raises(VerbExit) { Story.claim_all([ "s1" ], "agent-b") }
    assert_equal 2, error.code
    assert_equal "agent-a", find("s1").assignee
    assert_equal "claimed", find("s1").status
  end

  test "re-claiming what we already hold is success" do
    Story.claim_all([ "s1" ], "agent-a")
    assert_equal [ "claimed s1 as agent-a" ], Story.claim_all([ "s1" ], "agent-a")
  end

  test "claim is all-or-nothing" do
    Story.claim_all([ "s2" ], "other")
    assert_raises(VerbExit) { Story.claim_all(%w[s1 s2], "agent-a") }
    assert_equal "ready", find("s1").status
  end

  test "one claim records one event" do
    Story.claim_all([ "s1" ], "agent-a")
    assert_equal 1, Event.where(story_id: "s1", verb: "claim").count
  end

  test "claim refuses an unknown id" do
    error = assert_raises(VerbExit) { Story.claim_all([ "nope" ], "agent-a") }
    assert_equal [ 1, "story not found: nope" ], [ error.code, error.message ]
  end

  test "release returns a claimed story to ready and clears the holder" do
    Story.claim_all([ "s1" ], "agent-a")
    Story.release_all([ "s1" ])
    s = find("s1")
    assert_equal "ready", s.status
    assert_nil s.assignee
    assert_nil s.claim_at
  end

  test "release refuses a story that is not claimed" do
    error = assert_raises(VerbExit) { Story.release_all([ "s1" ]) }
    assert_equal [ 2, "s1 is ready, not claimed — nothing to release" ], [ error.code, error.message ]
  end

  test "in-progress stamps the PR and self-claims" do
    Story.mark_tracking_all([ "s1" ], "in-progress", "trails#42")
    s = find("s1")
    assert_equal [ "in-progress", "trails#42", "s1" ], [ s.status, s.pr, s.assignee ]
    assert_not_nil s.claim_at
  end

  test "mark_tracking skips an id already at this status and pr" do
    Story.mark_tracking_all([ "s1" ], "done", "trails#7")
    assert_equal [ "done s1 (already, skipped)", "done s2 trails#7" ], Story.mark_tracking_all(%w[s1 s2], "done", "trails#7")
    assert_equal 1, Event.where(story_id: "s1", verb: "done").count
  end

  test "block records the reason on the row and in the event" do
    find("s1").block("waiting on the API cutover")
    assert_equal [ "blocked", "waiting on the API cutover" ], [ find("s1").status, find("s1").blocked_by ]
    assert_equal({ note: "waiting on the API cutover" }.to_json, Event.find_by(story_id: "s1", verb: "block").detail)
  end

  test "close requires a reason" do
    error = assert_raises(VerbExit) { find("s1").close("  ") }
    assert_equal [ 1, "close requires a reason" ], [ error.code, error.message ]
  end

  test "close no-ops on an already-closed story" do
    find("s1").close("superseded")
    assert_equal "closed s1 (already, skipped)", find("s1").close("superseded")
    assert_equal 1, Event.where(story_id: "s1", verb: "close").count
  end

  test "close clears the fields the old status owned" do
    find("s1").block("stuck")
    find("s1").close("abandoned")
    assert_equal "abandoned", find("s1").closed_reason
    assert_nil find("s1").blocked_by
  end

  test "status_set clears a stale claim when moving to ready" do
    Story.claim_all([ "s1" ], "agent-a")
    find("s1").status_set("ready")
    assert_nil find("s1").assignee
    assert_nil find("s1").pr
    assert_equal 1, Event.where(story_id: "s1", verb: "status").count
  end

  test "priority_set sets and clears, recording each" do
    find("s1").priority_set(1)
    assert_equal 1, find("s1").priority
    find("s1").priority_set(nil)
    assert_nil find("s1").priority
    assert_equal 2, Event.where(story_id: "s1", verb: "priority").count
  end

  test "record_spawn records provenance without touching state" do
    Story.record_spawn([ "s1" ], "loop", branch: "b", pane: "p")
    assert_equal "loop", Event.find_by(story_id: "s1", verb: "spawn").actor
    assert_equal "ready", find("s1").status
  end

  test "an RFC-scoped spawn is recorded against the rfc" do
    Story.record_spawn([], "refine", rfc: "0136-trailmap")
    event = Event.find_by(verb: "spawn")
    assert_equal "0136-trailmap", event.rfc_id
    assert_nil event.story_id
  end

  test "updated_on stays a date: the touch is held to updated_at" do
    Story.claim_all([ "s1" ], "agent-a")
    find("s1").status_set("ready")
    assert_match(/\A\d{4}-\d\d-\d\d\z/, find("s1").updated_on)
  end

  test "the last story landing closes its RFC, but not the CI-failures RFC" do
    rfc!("0061-ci-failures")
    story!("fix", rfc_id: "0061-ci-failures")
    find("s1").close("dropped")
    find("s2").mark_tracking("done", nil)
    assert_equal "closed", Rfc.find("0136-trailmap").status
    assert_equal 1, Event.where(verb: "rfc-close", rfc_id: "0136-trailmap").count
    find("fix").mark_tracking("done", nil)
    assert_equal "active", Rfc.find("0061-ci-failures").status
  end

  test "status-set --from refuses the whole batch unless every story is in it" do
    find("s2").status_set("draft")
    error = assert_raises(VerbExit) { Story.status_set_all(%w[s1 s2], "ready", from: "draft") }
    assert_equal "not draft, nothing changed: s1 (ready)", error.message
    assert_equal "draft", find("s2").status
    assert_equal [ "status ready: s2" ], Story.status_set_all([ "s2" ], "ready", from: "draft")
  end
end
