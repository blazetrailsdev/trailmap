require "test_helper"
require "support/stand_in_ringo"

# `/sessions/file`, `/sessions/transcript` and `/sessions/pane` against a
# stand-in ringo, ported from ../../test/controllers/sessions-files.test.ts.
class SessionsFilesTest < ActionDispatch::IntegrationTest
  include StandInRingo

  TRANSCRIPT = [
    %({"type":"user","timestamp":"2026-08-26T14:00:00Z","sessionId":"0123456789abcdef","cwd":"/w/trails","message":{"role":"user","content":"port <the> thing"}}),
    %({"type":"assistant","timestamp":"2026-08-26T14:00:01Z","message":{"role":"assistant","model":"claude-opus-5","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls","description":"List files"}}]}}),
    %({"type":"user","timestamp":"2026-08-26T14:00:13Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"<script>x</script>"}]}}),
    %({"type":"assistant","timestamp":"2026-08-26T14:01:30Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}),
    %({"type":"attachment","timestamp":"2026-08-26T14:01:31Z"})
  ].join("\n").freeze
  # Bigger than the replay bound, ending in a line the tail must keep.
  BIG_LOG = (("x" * 80 + "\r\n") * (SessionsController::PANE_VIEW_MAX_BYTES / 82 * 1.25).to_i + "THE END\r\n").freeze
  # Past the parse bound: the session, then bookkeeping lines that run on beyond it.
  LONG_TRANSCRIPT = (TRANSCRIPT + %(\n{"type":"attachment","timestamp":"2026-08-26T14:02:00Z","pad":"#{"x" * 1000}"}) *
    (SessionsController::TRANSCRIPT_MAX_BYTES * 1.25 / 1060).ceil).freeze
  PANE_LOG = "plain \e[31mred <b>\e[0m\r\nsecond row\r\n".freeze
  RINGO = {
    "/sessions/file?p=trails%2F9001%2Fpane-42.log.gz" => [ 200, PANE_LOG ],
    "/sessions/file?p=trails%2F9001%2Fgone.log" => [ 404, "not found\n" ],
    "/sessions/file?p=trails%2F9001%2Fbig.log" => [ 200, BIG_LOG ],
    "/sessions/file?p=trails%2F9001%2Fa.jsonl" => [ 200, TRANSCRIPT ],
    "/sessions/file?p=trails%2F9001%2Flong.jsonl" => [ 200, LONG_TRANSCRIPT ]
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

  test "answers 413 for a file past the cap, without holding it whole" do
    limit = SessionsController::ARCHIVE_FILE_MAX_BYTES
    SessionsController.send(:remove_const, :ARCHIVE_FILE_MAX_BYTES)
    SessionsController.const_set(:ARCHIVE_FILE_MAX_BYTES, 4)
    with_ringo(RINGO) { get "/sessions/file", params: { p: "trails/9001/pane-42.log.gz" } }
    assert_response 413
    assert_includes response.body, "ringo serves it whole"
  ensure
    SessionsController.send(:remove_const, :ARCHIVE_FILE_MAX_BYTES)
    SessionsController.const_set(:ARCHIVE_FILE_MAX_BYTES, limit)
  end

  test "passes ringo's 404 through" do
    with_ringo(RINGO) { get "/sessions/file", params: { p: "trails/9001/gone.log" } }
    assert_response 404
    assert_equal "not found", response.body
  end

  test "draws the session ringo's reader reads back" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/sessions/transcript", params: { p: "trails/9001/a.jsonl" } }
    assert_response 200
    assert_equal [ "/sessions/file?p=trails%2F9001%2Fa.jsonl" ], asked
    body = response.body
    assert_includes body, "session 0123456789ab…"
    assert_includes body, '<div class="n">1m</div><div class="l">wall clock</div>'
    assert_includes body, "Tool mix"
    assert_includes body, "Where the time went"
    assert_includes body, "prompt 1 · 14:00:00"
    assert_includes body, "port &lt;the&gt; thing"
    assert_includes body, '<span class="tx-tool-sum">List files</span>'
    assert_includes body, "12.0s slow"
    assert_includes body, "&lt;script&gt;x&lt;/script&gt;"
    assert_includes body, "1 bookkeeping events"
    assert_not_includes body, "longer than trailmap reads"
  end

  test "parses only the head of a transcript past the bound" do
    with_ringo(RINGO) { get "/sessions/transcript", params: { p: "trails/9001/long.jsonl" } }
    assert_response 200
    assert_includes response.body, "port &lt;the&gt; thing"
    assert_includes response.body, "showing its first 4.0 MB"
  end

  # ringo's own page carried ringo's nav: /tasks, /velocity, /cost, /crons,
  # /logs, none of them a trailmap route. The layout's nav is trailmap's.
  test "links only to pages trailmap serves" do
    with_ringo(RINGO) { get "/sessions/transcript", params: { p: "trails/9001/a.jsonl" } }
    page = response.body[response.body.index('<main class="site-main">')..]
    assert_equal [ "/sessions/file?p=trails%2F9001%2Fa.jsonl" ], page.scan(/href="([^"]+)"/).flatten
    assert_includes response.body, '<nav class="nav">'
  end

  test "replays the log through ringo's renderer, escaped" do
    with_ringo(RINGO) { get "/sessions/pane", params: { p: "trails/9001/pane-42.log.gz" } }
    assert_response 200
    assert_includes response.body, "red &lt;b&gt;"
    assert_includes response.body, "<span style="
    assert_includes response.body, "second row"
    assert_not_includes response.body, "showing the last"
  end

  test "replays only the tail of a log past the bound" do
    with_ringo(RINGO) { get "/sessions/pane", params: { p: "trails/9001/big.log" } }
    assert_response 200
    assert_includes response.body, "THE END"
    assert_includes response.body, "showing the last 2.0 MB"
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
