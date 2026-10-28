require "test_helper"

class ReadModelsControllerTest < ActionDispatch::IntegrationTest
  setup do
    rfc!("0002-b", priority: 2, packages: [ "activerecord" ], clusters: [ "c" ], created_on: "2026-01-02")
    rfc!("0001-a", status: "draft")
    story!("zz", rfc_id: "0002-b", priority: 1)
    story!("aa", rfc_id: "0002-b")
    story!("held", rfc_id: "0001-a")
    Event.create!(at: "2026-01-02T00:00:00Z", verb: "claim", story_id: "zz")
    Event.create!(at: "2026-01-01T00:00:00Z", verb: "new", story_id: "aa", detail: "{}")
  end

  test "index orders RFCs by id and stories by (priority, id), in index.json's shape" do
    get "/index", headers: LOOPBACK
    body = JSON.parse(response.body)
    assert_equal %w[0001-a 0002-b], body["rfcs"].map { |r| r["id"] }
    assert_equal %w[zz aa held], body["stories"].map { |s| s["id"] }
    rfc = body["rfcs"].last
    assert_equal %w[id title status priority owner created updated packages clusters superseded_by related_rfcs file_path], rfc.keys
    assert_equal [ [ "activerecord" ], [ "c" ], [], "2026-01-02T00:00:00.000Z" ], rfc.values_at("packages", "clusters", "related_rfcs", "created")
    assert_equal "draft", body["stories"].last["status"]
  end

  test "events are oldest first in events.json's shape" do
    get "/events", headers: LOOPBACK
    events = JSON.parse(response.body)["events"]
    assert_equal %w[new claim], events.map { |e| e["verb"] }
    assert_equal({ "at" => "2026-01-01T00:00:00Z", "verb" => "new", "story" => "aa", "rfc" => nil, "pr" => nil,
                   "actor" => nil, "detail" => "{}" }, events.first)
  end

  test "is a 404 through the proxy" do
    get "/index", headers: { "HTTP_HOST" => "127.0.0.1", "X-Forwarded-For" => "1.2.3.4" }
    assert_response :not_found
  end
end
