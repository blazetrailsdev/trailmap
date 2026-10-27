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
  RINGO = { "/api/sessions" => [ 200, ARCHIVES.to_json ] }.freeze

  test "index renders ringo's archives in ringo's order with ringo's columns" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions" }
    assert_response 200
    assert_equal [ "/api/sessions" ], asked
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
