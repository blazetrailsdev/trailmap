require "test_helper"
require "support/stand_in_ringo"

# `/deploys/log` opens the run's own capture, found from its row, off the
# mounted pane-log directory.
class DeploysControllerTest < ActionDispatch::IntegrationTest
  include StandInRingo

  RUNS = [
    { id: "trailmap-200", status: "running", logFile: "/host/panes/pane-12.log" },
    { id: "ringo-100", status: "failed" }
  ].to_json

  setup do
    @dir = Dir.mktmpdir
    File.write(File.join(@dir, "pane-12.log"), "-----> Building trailmap\n")
    File.write(File.join(@dir, "pane-13.log"), "another pane\n")
    @was = Rails.configuration.x.deploys.logs_dir
    Rails.configuration.x.deploys.logs_dir = @dir
  end

  teardown do
    Rails.configuration.x.deploys.logs_dir = @was
    FileUtils.remove_entry(@dir)
  end

  test "log reads a run's own capture off the mount, asking ringo only for the history" do
    asked = []
    with_ringo({ "/api/deploys" => [ 200, RUNS ] }, asked: asked) { get "/deploys/log", params: { id: "trailmap-200" } }
    assert_equal "-----> Building trailmap\n", response.body
    assert_equal [ "/api/deploys" ], asked
  end

  test "log opens only the file the run names, whatever the request adds" do
    asked = []
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/output?id=ringo-100" => [ 200, "relayed\n" ] }
    with_ringo(answers, asked: asked) { get "/deploys/log", params: { id: "ringo-100", file: "pane-13.log" } }
    assert_equal "relayed\n", response.body
    assert_equal [ "/api/deploys", "/deploys/output?id=ringo-100" ], asked
  end

  test "screen replays a run's log through the terminal emulator: colours drawn, redraws applied, text escaped" do
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/output?id=ringo-100" => [ 200, "-----> \e[31mfailed\e[0m <b>\nab\rX\n" ] }
    with_ringo(answers) { get "/deploys/screen", params: { id: "ringo-100" } }
    assert_response :ok
    assert_equal "-----&gt; <span style=\"color:#e06c75;\">failed</span> &lt;b&gt;\nXb\n", response.body
  end

  test "screen passes a refusal through as plain text, unrendered" do
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/output?id=nope" => [ 404, "unknown deploy\n" ] }
    with_ringo(answers) { get "/deploys/screen", params: { id: "nope" } }
    assert_response :not_found
    assert_equal "unknown deploy\n", response.body
  end

  test "screen answers 404 for no id" do
    get "/deploys/screen"
    assert_response :not_found
    assert_equal "unknown deploy", response.body
  end

  test "screen hands the emulator the capture's bytes, undecoded" do
    raw = "ok \xFF\xE2\x82\n".b
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/output?id=ringo-100" => [ 200, raw ] }
    with_ringo(answers) { get "/deploys/screen", params: { id: "ringo-100" } }
    assert_equal RingoCore.render_pane_log(raw, SessionsController::PANE_VIEW_MAX_LINES)["html"].b, response.body.b
  end

  test "screen replays only the tail of a long log, as the pane view does" do
    long = "HEAD-MARKER\n" + ("x" * SessionsController::PANE_VIEW_MAX_BYTES) + "\nTAIL-MARKER\n"
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/output?id=ringo-100" => [ 200, long ] }
    with_ringo(answers) { get "/deploys/screen", params: { id: "ringo-100" } }
    assert_response :ok
    assert_includes response.body, "TAIL-MARKER"
    refute_includes response.body, "HEAD-MARKER"
  end
end
