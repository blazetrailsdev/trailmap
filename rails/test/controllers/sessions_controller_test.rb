require "test_helper"
require "support/stand_in_ringo"

# SessionsController against a stand-in ringo: the index in ringo's order and
# columns, one PR's archives, the JSON relayed in ringo's shape, and the
# relay's failures.
class SessionsControllerTest < ActionDispatch::IntegrationTest
  include StandInRingo

  ARCHIVES = [
    {
      "owner" => "blazetrailsdev", "repo" => "trails", "pr" => 9001, "pane" => "%42", "branch" => "fix-<arel>",
      "cwd" => "/w/fix-arel", "opened_at" => "2026-10-27T09:00:00Z", "closed_at" => "0001-01-01T00:00:00Z",
      "pane_log" => "panes/42.log", "pane_log_bytes" => 4_404_019,
      "transcripts" => [
        { "session_id" => "aaaaaaaa-1111-2222", "path" => "t/a.jsonl", "bytes" => 2048, "first_at" => "2026-10-27T09:00:00Z",
          "last_at" => "2026-10-27T10:00:00Z", "role" => "agent", "cwd" => "/w/fix-arel", "user_turns" => 7, "cost" => 1.5 },
        { "session_id" => "bbbbbbbb", "path" => "t/b.jsonl", "bytes" => 512, "first_at" => "2026-10-27T10:00:00Z",
          "last_at" => "2026-10-27T10:05:00Z", "role" => "reviewer", "cwd" => "/r/pr-9001", "cost" => 0.25 },
        { "session_id" => "cccccccc", "path" => "t/c.jsonl", "bytes" => 512, "first_at" => "2026-10-27T10:10:00Z",
          "last_at" => "2026-10-27T10:15:00Z", "role" => "reviewer", "cwd" => "/r/pr-9001", "cost" => 0.25 }
      ]
    },
    {
      "owner" => "blazetrailsdev", "repo" => "trailmap", "pr" => 80, "pane" => "%7", "opened_at" => "2026-10-20T08:00:00-04:00",
      "closed_at" => "2026-10-20T11:05:00-04:00", "reason" => "merge", "truncated" => true
    }
  ].freeze
  # ringo's `/api/sessions/status` in pilot mode, with captures no PR claimed.
  PILOT_STATUS = {
    mode: "pilot",
    note: "pilot mode: capturing 2 more spawn(s) and 1 hand-enrolled pane(s). Every other agent is ignored. Measure disk here before setting SESSION_ARCHIVE=on.",
    unclaimed_pane_logs: 3,
    unclaimed_pane_log_bytes: 5 * 1024 * 1024
  }.freeze
  # ringo's `/api/sessions/timeline` for trails#9001: an event, a wait, an event.
  TIMELINE = { events: 2, gap_floor: "1m", quiet_floor: "5m", elapsed: "1h30m", working: "1h00m", waiting: "30m", rows: [
    { kind: "session", when: "Oct 27 09:00", title: "agent <session>", ran: "1h00m", active: "40m", meta: ["7 turns · $1.50"] },
    { wait: "⋯ waiting 30m — PR sat unreviewed" },
    { kind: "review", when: "Oct 27 10:30", title: "review 1", body_html: "<p>looks <strong>good</strong></p>", open: true }
  ] }.freeze
  TIMELINE_PATH = "/api/sessions/timeline?owner=blazetrailsdev&pr=9001&repo=trails".freeze
  RINGO = { "/api/sessions" => [ 200, ARCHIVES.to_json ], "/api/sessions/status" => [ 200, PILOT_STATUS.to_json ] }.freeze

  test "index renders ringo's archives in ringo's order with ringo's columns" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions" }
    assert_response 200
    assert_equal [ "/api/sessions", "/api/sessions/status" ], asked.sort
    body = response.body
    %w[PR Branch Pane Opened Duration State Sessions Pane\ log Cost].each { |c| assert_includes body, "<th>#{c}</th>" }
    assert_includes body, "2 recorded"
    assert_operator body.index("trails#9001"), :<, body.index("trailmap#80")
    assert_includes body, 'href="/sessions/blazetrailsdev/trails/9001"'
    assert_includes body, "fix-&lt;arel&gt;"
    assert_not_includes body, "fix-<arel>"
    assert_includes body, '<span class="session-pill live">open</span>'
    assert_includes body, '<span class="session-pill">merge</span>'
    assert_includes body, "truncated"
    assert_match %r{1 <span class="session-role agent">agent</span>\s*·\s*1 <span class="session-role reviewer">reviewer</span>\s*<span class="muted">· 3 passes</span>}, body
    assert_includes body, "4.2 MB"
    assert_includes body, "$2.00"
    assert_includes body, "Oct 20 08:00"
    assert_includes body, "3h05m"
  end

  test "index says nothing is archived for ringo's null list" do
    with_ringo({ "/api/sessions" => [ 200, "null\n" ] }) { get "/sessions" }
    assert_response 200
    assert_includes response.body, "Nothing archived yet."
  end

  test "index shows ringo's archive mode note and its unclaimed pane captures" do
    with_ringo(RINGO) { get "/sessions" }
    assert_includes response.body, "mode: <strong>pilot</strong> — #{PILOT_STATUS[:note]}"
    assert_includes response.body, "3 unclaimed pane capture(s), 5.0 MB — panes armed at spawn that ended before linking to a PR. Kept and compressed, never deleted."
  end

  test "index shows neither note when the archive is on and every capture is claimed" do
    status = { mode: "on", note: "", unclaimed_pane_logs: 0, unclaimed_pane_log_bytes: 0 }
    with_ringo({ "/api/sessions" => [ 200, "null\n" ], "/api/sessions/status" => [ 200, status.to_json ] }) { get "/sessions" }
    assert_not_includes response.body, "mode: <strong>"
    assert_not_includes response.body, "unclaimed pane capture"
  end

  test "index shows neither note when ringo cannot say" do
    with_ringo({}) { get "/sessions" }
    assert_not_includes response.body, "mode: <strong>"
    assert_not_includes response.body, "unclaimed pane capture"
  end

  test "index says ringo is not configured rather than guessing where it is" do
    without_ringo { get "/sessions" }
    assert_response 200
    assert_includes response.body, "no ringo origin is configured"
  end

  test "index reports ringo's status, not a proxy's error page" do
    with_ringo({}) { get "/sessions" }
    assert_includes response.body, "ringo answered 502"
    assert_not_includes response.body, "Bad Gateway from nginx"
  end

  test "show renders one PR's archives with each transcript row" do
    with_ringo(RINGO) { get "/sessions/blazetrailsdev/trails/9001" }
    assert_response 200
    body = response.body
    assert_includes body, "blazetrailsdev/trails#9001"
    assert_includes body, "1 archived pane(s)"
    assert_includes body, "pane %42 · fix-&lt;arel&gt;"
    %w[Session Role First Last Turns Size Cost].each { |c| assert_includes body, "<th>#{c}</th>" }
    assert_includes body, "aaaaaaaa-111…"
    assert_includes body, "2.0 KB"
    assert_includes body, "$1.50"
    assert_includes body, "cwd /w/fix-arel"
    assert_not_includes body, "trailmap#80"
  end

  test "show renders ringo's timeline above the cards, in ringo's order" do
    with_ringo(RINGO.merge(TIMELINE_PATH => [ 200, TIMELINE.to_json ])) { get "/sessions/blazetrailsdev/trails/9001" }
    body = response.body
    assert_includes body, "2 events, oldest first"
    assert_includes body, '<div class="tl-ev k-session">'
    assert_includes body, "agent &lt;session&gt;"
    assert_includes body, '<span class="tl-dur tl-active">active 40m</span>'
    assert_includes body, '<details class="tl-body" open><summary>hide</summary><div class="md"><p>looks <strong>good</strong></p></div></details>'
    order = [ "Timeline", "agent &lt;session&gt;", "⋯ waiting 30m", "review 1", "pane %42" ].map { |text| body.index(text) }
    assert_equal order.sort, order
  end

  test "show keeps the cards when ringo cannot give the timeline" do
    with_ringo(RINGO) { get "/sessions/blazetrailsdev/trailmap/80" }
    assert_includes response.body, "pane %7"
    assert_not_includes response.body, 'class="tl-totals"'
  end

  test "show says a PR with no archive has none" do
    with_ringo(RINGO) { get "/sessions/blazetrailsdev/trails/1" }
    assert_response 200
    assert_includes response.body, "No archive recorded for this PR."
  end

  test "api relays ringo's index in ringo's JSON shape" do
    with_ringo(RINGO) { get "/api/sessions" }
    assert_response 200
    assert_equal ARCHIVES, JSON.parse(response.body)
  end

  test "api answers ringo's failure as a status, not an empty list" do
    with_ringo({}) { get "/api/sessions" }
    assert_response 502
    assert_equal "ringo answered 502", response.body
  end
end
