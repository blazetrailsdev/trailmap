require "test_helper"
require "support/stand_in_ringo"

# `GET /fleet/stories` and `GET /fleet/transcript`, ported from
# ../../test/controllers/fleet-controller-stories.test.ts and session-steps.test.ts.
class FleetStoriesTest < ActionDispatch::IntegrationTest
  include StandInRingo

  setup do
    rfc!("0188-mailer")
    story!("preview-interceptors", rfc_id: "0188-mailer", status: "in-progress", pr: "trails#9958", title: "Preview interceptors")
    story!("interceptor-string-arm", rfc_id: "0188-mailer", status: "in-progress", pr: "trails#9958", title: "String arm")
    story!("drafting-alone", rfc_id: "0188-mailer", status: "claimed", title: "Interceptor docs")
    Story.where(id: "drafting-alone").update_all(stage: "self")
  end

  def json = JSON.parse(response.body)

  test "answers every story a PR closes, by id, with an empty list for a ref nothing names" do
    get "/fleet/stories", params: { pr: [ "trails#9958", "trails#1" ] }
    assert_response :ok
    assert_equal %w[interceptor-string-arm preview-interceptors], json["trails#9958"].map { |s| s["id"] }
    assert_equal({ "id" => "preview-interceptors", "title" => "Preview interceptors", "status" => "in-progress", "rfc" => "0188-mailer", "stage" => nil },
                 json["trails#9958"][1])
    assert_equal [], json["trails#1"]
  end

  test "answers a spawn's story with its reported stage" do
    get "/fleet/stories", params: { story: [ "drafting-alone", "none" ] }
    assert_equal "self", json["drafting-alone"][0]["stage"]
    assert_equal [], json["none"]
  end

  test "refuses more than a hundred refs and a malformed one" do
    get "/fleet/stories", params: { pr: (1..101).map { |n| "trails##{n}" } }
    assert_response :bad_request
    get "/fleet/stories", params: { pr: [ "trails 1" ] }
    assert_response :bad_request
  end

  test "searches id and title, an id match first" do
    get "/fleet/stories", params: { q: "interceptor" }
    assert_equal %w[interceptor-string-arm preview-interceptors drafting-alone], json.map { |s| s["id"] }
    get "/fleet/stories", params: { q: "i" }
    assert_equal [], json
    get "/fleet/stories", params: { q: "" }
    assert_equal [], json
  end

  TRANSCRIPT = [
    %({"type":"user","timestamp":"2026-11-14T10:00:00Z","message":{"content":"newest"}}),
    %({"type":"assistant","timestamp":"2026-11-14T10:00:01Z","message":{"content":[{"type":"tool_use","id":"a","name":"Read","input":{"file_path":"x.ts"}}]}}),
    %({"type":"user","timestamp":"2026-11-14T10:00:02Z","message":{"content":[{"type":"tool_result","tool_use_id":"a","content":"ok"}]}})
  ].join("\n") + "\n"
  ARCHIVES = [ { owner: "blazetrailsdev", repo: "trails", pr: 9001, pane: "%42", opened_at: "2026-11-14T09:00:00Z",
                 transcripts: [
                   { session_id: "a", path: "trails/9001/old.jsonl", last_at: "2026-11-14T09:30:00Z", role: "agent" },
                   { session_id: "b", path: "trails/9001/new.jsonl", last_at: "2026-11-14T11:00:00Z", role: "agent" },
                   { session_id: "c", path: "trails/9001/review.jsonl", last_at: "2026-11-14T12:00:00Z", role: "reviewer" }
                 ] } ].freeze
  RINGO = {
    "/api/sessions" => [ 200, ARCHIVES.to_json ],
    "/sessions/file?p=trails%2F9001%2Fnew.jsonl" => [ 200, TRANSCRIPT ]
  }.freeze

  test "reads the newest worker transcript as steps, newest first" do
    asked = []
    with_ringo(RINGO, asked: asked) { get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: "9001" } }
    assert_response :ok
    assert_equal "trails/9001/new.jsonl", json["path"]
    assert_equal [ 1, 0 ], json["steps"].map { |s| s["i"] }
    assert_equal({ "kind" => "user", "text" => "newest" }, json["steps"][1].slice("kind", "text"))
    assert_equal({ "kind" => "tool", "tool" => "Read", "text" => "x.ts" }, json["steps"][0].slice("kind", "tool", "text"))
    assert_not asked.any? { |a| a.include?("review") }
    assert_includes response.headers["Cache-Control"], "no-store"
  end

  test "pages, answers nothing for a PR with no archive, and refuses no PR" do
    with_ringo(RINGO) { get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: "9001", before: "1" } }
    assert_equal [ 0 ], json["steps"].map { |s| s["i"] }
    with_ringo(RINGO) { get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: "1" } }
    assert_equal({ "archives" => 0, "path" => nil, "steps" => [], "total" => 0 }, json)
    get "/fleet/transcript", params: { owner: "o", repo: "r", pr: "x" }
    assert_response :bad_request
  end

  test "refuses a before or pr that is not plain digits, and reads limit like to_i" do
    with_ringo(RINGO) do
      [ " ", "1e2", "0x10", "1.0", "-1" ].each do |before|
        get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: "9001", before: before }
        assert_response :bad_request, before
      end
      [ "1e3", "0x1f", "01", "12345678901" ].each do |pr|
        get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: pr }
        assert_response :bad_request, pr
      end
      { "-5" => 2, "1.5" => 1, "abc" => 2 }.each do |limit, count|
        get "/fleet/transcript", params: { owner: "blazetrailsdev", repo: "trails", pr: "9001", limit: limit }
        assert_equal count, json["steps"].size, limit
      end
    end
  end

  test "transcript_steps skips a whitespace-only prompt" do
    assert_equal [], SessionsController.transcript_steps({ "Turns" => [ { "Prompt" => "  ", "At" => "t", "Steps" => [] } ] })
  end

  test "steps_page takes at most the limit before the step named" do
    all = (0...450).map { |i| { i: i } }
    assert_equal 200, SessionsController.steps_page(all, nil, 200).size
    assert_equal [ 49, 48 ], SessionsController.steps_page(all, 50, 200).first(2).map { |s| s[:i] }
    assert_equal [], SessionsController.steps_page(all, 0, 200)
  end
end
