require "test_helper"

# trails-status.txt, which the tasks repo's tracking cron writes beside tasks.db.
class TrailsTrackingTest < ActiveSupport::TestCase
  setup do
    @dir = Dir.mktmpdir
    @was = ENV["TASKS_DATABASE"]
    ENV["TASKS_DATABASE"] = File.join(@dir, "tasks.db")
  end

  teardown do
    ENV["TASKS_DATABASE"] = @was
    FileUtils.remove_entry(@dir)
  end

  test "reads the status the last tracking run wrote beside tasks.db" do
    File.write(File.join(@dir, "trails-status.txt"), "pin        6bf0fbd\nbehind     3 commits\n")
    assert_equal "pin        6bf0fbd\nbehind     3 commits", TrailsTracking.status
  end

  test "is nil before any run has written one" do
    assert_nil TrailsTracking.status
  end

  test "is nil without a tasks database" do
    ENV["TASKS_DATABASE"] = nil
    assert_nil TrailsTracking.status
  end

  test "is failing when trails:status escalated a held pin" do
    assert TrailsTracking.failing?("pin x\n\nERROR: the trails pin has been held")
    assert_not TrailsTracking.failing?("pin x\nlast run   bumped")
  end
end
