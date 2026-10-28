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
    answers = { "/api/deploys" => [ 200, RUNS ], "/deploys/log?id=ringo-100" => [ 200, "relayed\n" ] }
    with_ringo(answers, asked: asked) { get "/deploys/log", params: { id: "ringo-100", file: "pane-13.log" } }
    assert_equal "relayed\n", response.body
    assert_equal [ "/api/deploys", "/deploys/log?id=ringo-100" ], asked
  end
end
