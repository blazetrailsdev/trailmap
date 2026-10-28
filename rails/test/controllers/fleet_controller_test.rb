require "test_helper"
require "support/stand_in_ringo"

# FleetController against a stand-in ringo: the WebSocket handshake's guards,
# the pane screen relay, and the reads and controls it forwards.
class FleetControllerTest < ActionDispatch::IntegrationTest
  include StandInRingo

  test "socket refuses a handshake from another origin, or none" do
    with_ringo({}) do
      get "/fleet/socket"
      assert_response :not_found
      get "/fleet/socket", headers: { "Origin" => "https://elsewhere.example" }
      assert_response :not_found
    end
  end

  test "socket answers 426 to a same-origin request that is not a WebSocket" do
    with_ringo({}) { get "/fleet/socket", headers: { "Origin" => "http://www.example.com" } }
    assert_response :upgrade_required
    assert_equal "This endpoint speaks WebSocket only", response.body
  end

  test "socket says ringo is not configured" do
    without_ringo { get "/fleet/socket", headers: { "Origin" => "http://www.example.com" } }
    assert_response :service_unavailable
  end

  test "screen rejects a bad pane id or an oversized hash before asking ringo" do
    asked = []
    with_ringo({}, asked: asked) do
      get "/fleet/pane/%2542/screen"
      assert_response :bad_request
      get "/fleet/pane/42/screen", params: { have: "x" * (Fleet::SCREEN_HASH_MAX + 1) }
      assert_response :bad_request
    end
    assert_empty asked
  end

  test "screen relays ringo's JSON, with the hash it already has" do
    asked = []
    with_ringo({ "/pane/42/screen?have=abc" => [ 200, '{"exists":true,"hash":"abd"}' ] }, asked: asked) do
      get "/fleet/pane/42/screen", params: { have: "abc" }
    end
    assert_response :success
    assert_equal({ "exists" => true, "hash" => "abd" }, JSON.parse(response.body))
    assert_equal [ "/pane/42/screen?have=abc" ], asked
  end

  test "screen answers 200 exists:false for a gone pane, whatever ringo's status" do
    with_ringo({ "/pane/7/screen" => [ 404, '{"exists":false}' ] }) { get "/fleet/pane/7/screen" }
    assert_response :success
    assert_equal({ "exists" => false }, JSON.parse(response.body))
  end

  test "screen passes any other failure through" do
    with_ringo({}) { get "/fleet/pane/7/screen" }
    assert_response :bad_gateway
  end

  test "reviewers and the named reads relay ringo's answer" do
    answers = { "/reviewer/list" => [ 200, "[]" ], "/reviewer/drain-status?agent=codex" => [ 200, "{}" ] }
    asked = []
    with_ringo(answers, asked: asked) do
      get "/fleet/reviewers"
      assert_response :success
      get "/fleet/read/drain-status", params: { agent: "codex" }
      assert_response :success
      get "/fleet/read/nope"
      assert_response :not_found
    end
    assert_equal [ "/reviewer/list", "/reviewer/drain-status?agent=codex" ], asked
  end

  test "control forwards an allowlisted path and refuses anything else" do
    posted = []
    relay = lambda do |url, body:, content_type:, timeout:|
      posted << [ url, body ]
      Net::HTTPOK.new("1.1", "200", "").tap { |r| r.instance_variable_set(:@body, "ok"); r.instance_variable_set(:@read, true) }
    end
    with_ringo({}) do
      Fleet::Relay.stub(:post, relay) do
        post "/fleet/control/spawn", params: "x=1", headers: { "CONTENT_TYPE" => "application/x-www-form-urlencoded" }
        assert_response :success
        assert_equal "ok", response.body
        post "/fleet/control/rm-rf"
        assert_response :not_found
      end
    end
    assert_equal [ [ "#{StandInRingo::BASE}/spawn", "x=1" ] ], posted
  end
end
