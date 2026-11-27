require "test_helper"

class SentryInitializerTest < ActiveSupport::TestCase
  test "sends nothing without SENTRY_DSN" do
    assert_nil ENV["SENTRY_DSN"]
    assert_not Sentry.initialized?
  end
end
