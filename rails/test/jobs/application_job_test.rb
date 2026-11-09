require "test_helper"

class ApplicationJobTest < ActiveJob::TestCase
  class RetriedJob < ApplicationJob
    retry_on RuntimeError, attempts: 2, wait: 0

    def perform
      raise "still flaky"
    end
  end

  setup do
    @was = ENV["EMAIL"]
    ENV["EMAIL"] = "ops@example.com"
    ActionMailer::Base.deliveries.clear
  end

  teardown { ENV["EMAIL"] = @was }

  test "mails EMAIL the job, its arguments and the exception when a job raises unhandled" do
    job = FailingProbeJob.new("from a test")
    assert_raises(DeliberateFailure) { job.perform_now }
    assert_equal 1, ActionMailer::Base.deliveries.size
    mail = ActionMailer::Base.deliveries.first
    assert_equal [ "ops@example.com" ], mail.to
    assert_equal "[trailmap] FailingProbeJob failed: DeliberateFailure: deliberate failure from /mail-test: from a test", mail.subject
    body = mail.body.to_s
    assert_includes body, "Job id:     #{job.job_id}"
    assert_includes body, 'Arguments:  ["from a test"]'
    assert_includes body, "Executions: 1"
    assert_includes body, "Backtrace:\nDeliberateFailure: deliberate failure"
    assert_not_includes body, "Stage:"
  end

  test "mails once, when retryOn runs out of attempts, and not while a retry is due" do
    job = RetriedJob.new
    job.stub(:retry_job, nil) { job.perform_now }
    assert_equal 0, ActionMailer::Base.deliveries.size
    assert_raises(RuntimeError) { job.perform_now }
    assert_equal 1, ActionMailer::Base.deliveries.size
    assert_includes ActionMailer::Base.deliveries.first.body.to_s, "Executions: 2"
  end

  test "sends nothing and still raises when EMAIL is not set" do
    ENV.delete("EMAIL")
    assert_raises(DeliberateFailure) { FailingProbeJob.new("x").perform_now }
    assert_equal 0, ActionMailer::Base.deliveries.size
  end

  test "raises the job's own error, not the mailer's, when delivery fails" do
    refused = Class.new { def initialize(*) = nil; def deliver!(*) = raise("connection refused") }
    ActionMailer::Base.add_delivery_method :refused, refused
    was = ActionMailer::Base.delivery_method
    ActionMailer::Base.delivery_method = :refused
    assert_raises(DeliberateFailure) { FailingProbeJob.new("x").perform_now }
  ensure
    ActionMailer::Base.delivery_method = was
  end
end
