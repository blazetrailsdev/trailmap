require "test_helper"
require "minitest/mock"

class SentryInitializerTest < ActiveSupport::TestCase
  INITIALIZER = Rails.root.join("config/initializers/sentry.rb").to_s

  def run_initializer(dsn, git_rev: nil)
    env = { "SENTRY_DSN" => dsn, "GIT_REV" => git_rev }
    calls = []
    Sentry.stub(:init, ->(&block) { config = Sentry::Configuration.new; block.call(config); calls << config }) do
      ENV.stub(:[], ->(key) { env.key?(key) ? env[key] : ENV.fetch(key, nil) }) do
        load INITIALIZER
      end
    end
    calls
  end

  test "sends nothing without SENTRY_DSN" do
    assert_empty run_initializer(nil)
    assert_empty run_initializer("")
  end

  test "starts Sentry with the DSN when SENTRY_DSN is set" do
    calls = run_initializer("http://key@bugsink.web:8000/1", git_rev: "abc123")
    assert_equal 1, calls.size
    assert_equal "http://key@bugsink.web:8000/1", calls.first.dsn.to_s
    assert_equal Rails.env, calls.first.environment
    assert_equal "abc123", calls.first.release
  end
end
