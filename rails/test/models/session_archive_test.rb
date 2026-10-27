require "test_helper"
require "support/stand_in_ringo"

class SessionArchiveTest < ActiveSupport::TestCase
  include StandInRingo

  OPEN = {
    "owner" => "o", "repo" => "r", "pr" => 1, "pane" => "%1", "opened_at" => "2026-10-27T09:00:00-04:00",
    "closed_at" => "0001-01-01T00:00:00Z",
    "transcripts" => [
      { "session_id" => "s1", "path" => "a", "bytes" => 1, "first_at" => "", "last_at" => "", "role" => "agent", "cwd" => "/w", "cost" => 1 },
      { "session_id" => "s2", "path" => "b", "bytes" => 1, "first_at" => "", "last_at" => "", "role" => "agent", "cwd" => "/w", "cost" => 0.5 },
      { "session_id" => "s3", "path" => "c", "bytes" => 1, "first_at" => "", "last_at" => "", "role" => "reviewer", "cost" => 0.25 },
      { "session_id" => "s4", "path" => "d", "bytes" => 1, "first_at" => "", "last_at" => "", "role" => "reviewer" }
    ]
  }.freeze
  CLOSED = {
    "owner" => "o", "repo" => "r", "pr" => 2, "pane" => "%2", "opened_at" => "2026-10-27T09:00:00Z",
    "closed_at" => "2026-10-27T10:30:00Z", "reason" => "merge"
  }.freeze
  RINGO = { "/api/sessions" => [ 200, [ OPEN, CLOSED ].to_json ] }.freeze

  test "from_row keeps ringo's row and casts its fields" do
    a = SessionArchive.from_row(CLOSED)
    assert_same CLOSED, a.row
    assert_equal [ "o", "r", 2, "%2", "", "merge", "", 0, false ],
                 [ a.owner, a.repo, a.pr, a.pane, a.branch, a.reason, a.pane_log, a.pane_log_bytes, a.truncated ]
    assert_equal [], a.transcripts
  end

  test "all keeps ringo's order" do
    with_ringo(RINGO) { assert_equal [ 1, 2 ], SessionArchive.all.map(&:pr) }
  end

  test "all raises Unavailable without ringo, or on a non-JSON answer" do
    without_ringo { assert_raises(SessionArchive::Unavailable) { SessionArchive.all } }
    with_ringo({ "/api/sessions" => [ 200, "not json" ] }) do
      error = assert_raises(SessionArchive::Unavailable) { SessionArchive.all }
      assert_match "not with the session archive as JSON", error.message
    end
  end

  test "for_pr filters to one PR" do
    with_ringo(RINGO) { assert_equal [ "%2" ], SessionArchive.for_pr(owner: "o", repo: "r", pr: 2).map(&:pane) }
  end

  test "reads Go's zero time as open" do
    open = SessionArchive.from_row(OPEN)
    closed = SessionArchive.from_row(CLOSED)
    assert open.open?
    assert_nil open.closed_at
    assert_not closed.open?
    assert_equal Time.utc(2026, 10, 27, 10, 30), closed.closed_at
    assert_equal Time.utc(2026, 10, 27, 13), open.opened_at
  end

  test "duration runs to now while open, to closed_at once closed" do
    assert_equal 90 * 60_000, SessionArchive.from_row(CLOSED).duration
    assert_equal 60 * 60_000, SessionArchive.from_row(OPEN).duration(Time.utc(2026, 10, 27, 14))
  end

  test "cost sums the transcripts" do
    assert_equal 1.75, SessionArchive.from_row(OPEN).cost
    assert_equal 0, SessionArchive.from_row(CLOSED).cost
  end

  test "role_split counts runners by checkout, falling back to the session" do
    assert_equal({ agents: 1, reviewers: 2, passes: 4 }, SessionArchive.from_row(OPEN).role_split)
  end
end
