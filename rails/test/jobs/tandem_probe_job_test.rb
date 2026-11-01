require "test_helper"

class TandemProbeJobTest < ActiveSupport::TestCase
  FIXTURES = Rails.root.join("..", "test/fixtures/solid-queue")

  setup { TandemProbeJob.performed.clear }

  test "runs a payload the trails app serialized" do
    ActiveJob::Base.execute(JSON.parse(FIXTURES.join("trails-enqueued.json").read))
    assert_equal [ "from trails" ], TandemProbeJob.performed
  end

  test "the committed Rails payload is what this app serializes" do
    fixture = JSON.parse(FIXTURES.join("rails-enqueued.json").read)
    serialized = TandemProbeJob.new("from rails").serialize
    assert_equal fixture.keys.sort, serialized.keys.sort
    assert_equal fixture.slice("job_class", "arguments", "queue_name"),
      serialized.slice("job_class", "arguments", "queue_name")
  end
end
