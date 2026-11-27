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
  PREVIEW_RUNS = [
    { id: "trailmap-pr-160-2", app: "trailmap-pr-160", status: "success", started: "2026-11-19T19:00:00Z",
      target: "preview", url: "https://trailmap-pr-160.deanoftech.com/" },
    { id: "trailmap-pr-160-1", app: "trailmap-pr-160", status: "cancelled", started: "2026-11-19T18:50:00Z",
      target: "preview", url: "javascript:alert(1)" },
    { id: "trailmap-previews-1", app: "trailmap-previews", status: "success", started: "2026-11-19T18:00:00Z",
      target: "preview sweep" },
    { id: "trailmap-200", app: "trailmap", status: "success", started: "2026-11-19T17:00:00Z" }
  ].to_json

  test "tags preview runs, links a successful preview, and links only https" do
    with_ringo({ "/api/deploys" => [ 200, PREVIEW_RUNS ] }) { get "/deploys" }
    assert_response :success
    assert_includes response.body, '<span class="badge deploy-kind">preview</span>'
    assert_includes response.body, '<span class="badge deploy-kind">preview sweep</span>'
    assert_includes response.body, '<a class="deploy-url" href="https://trailmap-pr-160.deanoftech.com/">open preview</a>'
    assert_includes response.body, "s-deploy-cancelled"
    assert_not_includes response.body, "javascript:"
    assert_equal 3, response.body.scan("deploy-kind").size
  end

  test "a preview shows its banner, and production does not" do
    was = Rails.configuration.x.preview.pr
    Rails.configuration.x.preview.pr = "160"
    with_ringo({ "/api/deploys" => [ 200, "[]" ] }) { get "/deploys" }
    assert_includes response.body, 'class="preview-banner"'
    assert_includes response.body, 'href="https://github.com/blazetrailsdev/trailmap/pull/160">trailmap#160</a>'
    Rails.configuration.x.preview.pr = nil
    with_ringo({ "/api/deploys" => [ 200, "[]" ] }) { get "/deploys" }
    assert_not_includes response.body, "preview-banner"
  ensure
    Rails.configuration.x.preview.pr = was
  end
end
