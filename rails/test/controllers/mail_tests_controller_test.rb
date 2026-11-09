require "test_helper"

class MailTestsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @was = ENV["EMAIL"]
    ENV.delete("EMAIL")
    ActionMailer::Base.deliveries.clear
  end

  teardown { ENV["EMAIL"] = @was }

  test "renders both forms and says where failure mail goes" do
    ENV["EMAIL"] = "ops@example.com"
    get "/mail-test"
    assert_response 200
    assert_includes response.body, 'action="/mail-test"'
    assert_includes response.body, 'action="/mail-test/failing-job"'
    assert_includes response.body, "<code>ops@example.com</code>"
    assert_not_includes response.body, 'id="mailTestOutcome"'
  end

  test "says no one gets failure mail when EMAIL is not set" do
    get "/mail-test"
    assert_includes response.body, "<code>EMAIL</code> is not set"
  end

  test "sends a test email to the given address and reports it" do
    post "/mail-test", params: { to: "someone@example.com" }
    assert_response 200
    assert_includes response.body, "Sent a test email to someone@example.com."
    assert_equal 1, ActionMailer::Base.deliveries.size
    assert_equal [ "someone@example.com" ], ActionMailer::Base.deliveries.first.to
    assert_equal "[trailmap] test email", ActionMailer::Base.deliveries.first.subject
  end

  test "refuses a missing address without sending" do
    post "/mail-test", params: { to: " " }
    assert_response 422
    assert_includes response.body, "Give an email address to send to."
    assert_equal 0, ActionMailer::Base.deliveries.size
  end

  test "shows the relay's error when delivery fails" do
    refused = Class.new { def initialize(*) = nil; def deliver!(*) = raise("connection refused") }
    ActionMailer::Base.add_delivery_method :refused, refused
    ActionMailer::Base.delivery_method = :refused
    post "/mail-test", params: { to: "someone@example.com" }
    assert_response 502
    assert_includes response.body, "could not be sent: connection refused"
  ensure
    ActionMailer::Base.delivery_method = :test
  end

  test "enqueues FailingProbeJob and names where its failure is mailed" do
    ENV["EMAIL"] = "ops@example.com"
    assert_enqueued_jobs 1, only: FailingProbeJob do
      post "/mail-test/failing-job"
    end
    assert_response 200
    assert_match(/Enqueued FailingProbeJob [0-9a-f-]+\. When the worker runs it, its failure is mailed to ops@example\.com\./, response.body)
  end
end
