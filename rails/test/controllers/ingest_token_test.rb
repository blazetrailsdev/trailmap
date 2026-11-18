require "test_helper"

# The token guard on the ingest create endpoints, ported from
# ../../test/controllers/ingest-token.test.ts. Every case here is refused
# before the action runs, so none needs the hub; the pass-through case is
# rfc_refinements_test.rb, which posts with the token.
class IngestTokenTest < ActionDispatch::IntegrationTest
  setup do
    @saved_token = ENV["TRAILMAP_INGEST_TOKEN"]
    ENV["TRAILMAP_INGEST_TOKEN"] = "s3cret"
  end

  teardown { ENV["TRAILMAP_INGEST_TOKEN"] = @saved_token }

  def report(headers)
    post "/rfc-refines", params: "{}", headers: headers.merge("CONTENT_TYPE" => "application/json")
  end

  test "refuses a missing token with the framework's challenge" do
    report(LOOPBACK)
    assert_response :unauthorized
    assert_equal 'Token realm="Application"', response.headers["WWW-Authenticate"]
  end

  test "refuses a wrong token" do
    report(LOOPBACK.merge("HTTP_AUTHORIZATION" => "Bearer nope"))
    assert_response :unauthorized
  end

  test "refuses every request when TRAILMAP_INGEST_TOKEN is unset" do
    ENV.delete("TRAILMAP_INGEST_TOKEN")
    report(LOOPBACK.merge("HTTP_AUTHORIZATION" => "Bearer s3cret"))
    assert_response :unauthorized
  end

  test "runs LoopbackOnly first, so a proxied request with a valid token is a 404" do
    report("HTTP_HOST" => "trailmap.deanoftech.com", "HTTP_X_FORWARDED_FOR" => "1.2.3.4",
           "HTTP_AUTHORIZATION" => "Bearer s3cret")
    assert_response :not_found
  end
end
