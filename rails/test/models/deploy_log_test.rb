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

  test "is nil with no mount or a name that is not a file name" do
    assert_nil DeployLog.read("..")
    Rails.configuration.x.deploys.logs_dir = nil
    assert_nil DeployLog.read("pane-12.log")
  end
end
