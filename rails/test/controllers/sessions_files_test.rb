require "test_helper"
require "support/stand_in_ringo"

# `/sessions/file`, `/sessions/transcript` and `/sessions/pane` against a
# stand-in ringo, ported from ../../test/controllers/sessions-files.test.ts.
# The two replay cases are not here: DEVIATIONS.md, "the pane replay".
class SessionsFilesTest < ActionDispatch::IntegrationTest
  include StandInRingo

  PANE_LOG = "plain \e[31mred <b>\e[0m\r\nsecond row\r\n".freeze
  RINGO = {
    "/sessions/file?p=trails%2F9001%2Fpane-42.log.gz" => [ 200, PANE_LOG ],
    "/sessions/file?p=trails%2F9001%2Fgone.log" => [ 404, "not found\n" ],
    "/sessions/transcript?p=trails%2F9001%2Fa.jsonl" => [ 200, "<h1>fix arel</h1>" ]
  }.freeze

  test "accepts a path the archive writes" do
    assert_nil SessionsController.archive_path_problem("blazetrailsdev/trails/9001/pane-42.log.gz")
  end

  test "refuses a traversal" do
    assert_includes SessionsController.archive_path_problem("trails/../../etc/passwd"), "escapes the archive root"
  end

  test "refuses a dotfile" do
    assert_includes SessionsController.archive_path_problem("trails/.env"), "dotfile"
  end

  test "refuses an absolute path" do
    assert_includes SessionsController.archive_path_problem("/etc/passwd"), "empty segment"
  end

  test "refuses a backslash separator" do
    assert_includes SessionsController.archive_path_problem("trails\\..\\x"), "character"
  end

  test "refuses a missing path" do
    assert_equal "missing p", SessionsController.archive_path_problem("")
  end

  test "relays one file as ringo serves it" do
    with_ringo(RINGO) { get "/sessions/file", params: { p: "trails/9001/pane-42.log.gz" } }
    assert_response 200
    assert_equal PANE_LOG, response.body
    assert_equal 'inline; filename="pane-42.log"', response.headers["Content-Disposition"]
  end

  test "refuses a bad path without asking ringo" do
    asked = []
    with_ringo(RINGO, asked: asked) do
      [ "../index.json", "trails/.git", "/abs", "a\\b" ].each do |p|
        get "/sessions/file", params: { p: p }
        assert_response 400
      end
    end
    assert_empty asked
  end

  test "passes ringo's 404 through" do
    with_ringo(RINGO) { get "/sessions/file", params: { p: "trails/9001/gone.log" } }
    assert_response 404
    assert_equal "not found", response.body
  end

  test "relays ringo's transcript page" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions/transcript", params: { p: "trails/9001/a.jsonl" } }
    assert_response 200
    assert_equal "<h1>fix arel</h1>", response.body
    assert_equal [ "/sessions/transcript?p=trails%2F9001%2Fa.jsonl" ], asked
  end

  # ringo's HTML is served on trailmap's origin; whatever it fails to escape
  # must not run there.
  test "sandboxes the relayed page" do
    with_ringo(RINGO) { get "/sessions/transcript", params: { p: "trails/9001/a.jsonl" } }
    assert_equal "sandbox", response.headers["Content-Security-Policy"]
  end

  test "sends a transcript to the transcript page" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions/pane", params: { p: "trails/9001/a.jsonl" } }
    assert_response 302
    assert_includes response.headers["Location"], "/sessions/transcript?p=trails%2F9001%2Fa.jsonl"
    assert_empty asked
  end

  test "refuses a traversal without asking ringo" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions/pane", params: { p: "../../etc/passwd" } }
    assert_response 400
    assert_empty asked
  end
end
