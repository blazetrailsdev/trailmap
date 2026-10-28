require "test_helper"

# The read verbs over HTTP, ported from ../../test/controllers/stories-controller.test.ts.
class StoriesControllerTest < ActionDispatch::IntegrationTest
  setup do
    rfc!("0136-trailmap")
    rfc!("0002-draft", status: "draft")
    story!("dependent", rfc_id: "0136-trailmap", est_loc: 200, cluster: "api", paths: [ "app/controllers/stories-controller.ts" ])
    story!("unblocked", rfc_id: "0136-trailmap", est_loc: 50, cluster: "api")
    story!("shadowed", rfc_id: "0002-draft", est_loc: 10)
    # Last: the RFC auto-closes when every story is done.
    story!("base", rfc_id: "0136-trailmap", status: "done", est_loc: 40, cluster: "api", updated_on: "2026-08-28",
                   file_path: "rfcs/0136-trailmap/stories/base.md")
    StoryDep.create!(story_id: "dependent", depends_on_id: "base")
  end

  def get_json(path, params: {}, headers: {})
    get path, params: params, headers: LOOPBACK.merge(headers)
    JSON.parse(response.body)
  end

  test "serves the ready queue" do
    assert_equal %w[dependent unblocked], get_json("/stories/ready").map { |s| s["id"] }
    assert_response :ok
  end

  test "scopes the ready queue to an RFC" do
    assert_equal [], get_json("/stories/ready", params: { rfc: "0002-draft" })
  end

  test "serves next-bundle as the object the spawn loop unmarshals" do
    body = get_json("/stories/next-bundle", params: { "max-loc" => "60" })
    assert_equal [ "unblocked" ], body["stories"].map { |s| s["id"] }
    assert_equal [ 50, 60, false, nil ], body.values_at("bundle_total_loc", "max_loc", "lead_exceeds_budget", "empty_reason")
    assert_equal %w[stories bundle_total_loc max_loc lead_exceeds_budget empty_reason], body.keys
  end

  test "says why next-bundle came back empty, and defaults the budget" do
    body = get_json("/stories/next-bundle", params: { "max-loc" => "5" })
    assert_equal [ [], "none-within-budget" ], body.values_at("stories", "empty_reason")
    assert_equal 250, get_json("/stories/next-bundle")["max_loc"]
  end

  test "lists every story in index.json order, and filters" do
    assert_equal %w[base dependent shadowed unblocked], get_json("/stories").map { |s| s["id"] }
    assert_equal 1, get_json("/stories", params: { status: "done" }).size
    assert_equal 1, get_json("/stories", params: { rfc: "0002-draft" }).size
    assert_equal 3, get_json("/stories", params: { cluster: "api" }).size
  end

  test "shows one story as a bare object, fields in the contract's order" do
    body = get_json("/stories/base")
    assert_equal %w[id rfc title status raw_status cluster packages priority updated deps deps_rfc est_loc pr claim
                    assignee blocked_by closed_reason story_paths file_path], body.keys
    assert_equal "rfcs/0136-trailmap/stories/base.md", body["file_path"]
    assert_equal "2026-08-28T00:00:00.000Z", body["updated"]
  end

  test "a missing story is a 404" do
    assert_equal({ "error" => 'story "nope" not found' }, get_json("/stories/nope"))
    assert_response :not_found
  end

  test "downgrades a ready story under a non-active RFC, keeping the authored value" do
    body = get_json("/stories/shadowed")
    assert_equal [ "draft", "ready" ], body.values_at("status", "raw_status")
  end

  test "touching finds by path, and refuses no path" do
    assert_equal [ "dependent" ], get_json("/stories/touching", params: { path: "app/controllers/stories-controller.ts" }).map { |s| s["id"] }
    assert_equal({ "error" => "touching requires a path" }, get_json("/stories/touching"))
    assert_response :bad_request
  end

  test "negotiates JSON as Rails' negotiate_mime does" do
    [ nil, "text/html, */*", "application/*", "text/html;q=0.9, application/json;q=0.5" ].each do |accept|
      get_json("/stories/ready", headers: accept ? { "Accept" => accept } : {})
      assert_response :ok, "Accept: #{accept.inspect}"
    end
    assert_equal({ "error" => "not_acceptable" }, get_json("/stories/ready", headers: { "Accept" => "text/html" }))
    assert_response :not_acceptable
  end

  test "is not reachable from the public hostname" do
    get "/stories/ready", headers: { "HTTP_HOST" => "trailmap.deanoftech.com", "X-Forwarded-For" => "203.0.113.7" }
    assert_response :not_found
    assert_equal({ "error" => "not_found" }, JSON.parse(response.body))
  end
end
