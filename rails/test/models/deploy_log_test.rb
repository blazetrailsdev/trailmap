require "test_helper"

# DeployLog reads ringo's pane-log directory, mounted read-only.
class DeployLogTest < ActiveSupport::TestCase
  setup do
    @dir = Dir.mktmpdir
    @was = Rails.configuration.x.deploys.logs_dir
    Rails.configuration.x.deploys.logs_dir = @dir
  end

  teardown do
    Rails.configuration.x.deploys.logs_dir = @was
    FileUtils.remove_entry(@dir)
  end

  test "reads a raw capture by its base name, whatever host path ringo recorded" do
    File.write(File.join(@dir, "pane-12.log"), "-----> Building\n")
    assert_equal "-----> Building\n", DeployLog.read("/host/panes/pane-12.log")
  end

  test "reads the gzipped capture a sweep left" do
    Zlib::GzipWriter.open(File.join(@dir, "pane-13.log.gz")) { |gz| gz.write("done\n") }
    assert_equal "done\n", DeployLog.read("pane-13.log")
  end

  test "names the path asked for when neither is there" do
    assert_equal "(pane log unreadable: #{@dir}/gone.log: no such file or directory)", DeployLog.read("gone.log")
  end

  test "reads locally only with a mount and a bare file name" do
    assert DeployLog.local?("pane-12.log")
    assert_not DeployLog.local?("..")
    Rails.configuration.x.deploys.logs_dir = nil
    assert_not DeployLog.local?("pane-12.log")
  end

  test "screen replays only the tail, within the rows asked for" do
    assert_equal({ html: "TAIL\n" }, DeployLog.screen("HEAD\nmiddle\nTAIL\n", 5, 100))
  end

  test "screen answers an emulator failure as a problem, not a raise" do
    failing = ->(*) { raise RingoCore::Error, "ringo core pane exited 2: bad capture" }
    assert_equal({ problem: "log not rendered: ringo core pane exited 2: bad capture" },
                 DeployLog.screen("a", 100, 100, render: failing))
  end
end
