require "test_helper"

# Every page renders, against a small task domain and hub. A smoke test: the
# detailed rules have their own tests.
class PagesTest < ActionDispatch::IntegrationTest
  setup do
    rfc!("0001-alpha", priority: 1, packages: [ "activerecord" ], created_on: "2026-01-01")
    rfc!("0002-beta", status: "draft")
    story!("a-one", rfc_id: "0001-alpha", est_loc: 100, cluster: "c1", paths: [ "packages/activerecord/x.ts" ])
    story!("a-two", rfc_id: "0001-alpha", deps: [ "a-one" ], pr: "trails#5", status: "in-progress",
                    claim_at: "2026-01-02T00:00:00Z", assignee: "a-two")
    story!("b-one", rfc_id: "0002-beta")
    Event.create!(at: Time.now.utc.iso8601, verb: "claim", story_id: "a-two", actor: "a-two")
  end

  test "the task-domain pages render" do
    %w[/ /rfcs /rfcs?status=draft /rfc/0001-alpha /backlog /backlog?filter=ready /story/a-two
       /search?q=alpha /graphs/parity /audits /deploys /dashboard /panes/42].each do |path|
      get path
      assert_response :success, "#{path} answered #{response.status}"
    end
  end

  test "a missing RFC or story is a 404 page that names the id" do
    get "/rfc/nope"
    assert_response :not_found
    assert_includes response.body, "nope"
    get "/story/nope"
    assert_response :not_found
  end

  test "the repository pages render" do
    require_hub!
    hub_repo!("trails")
    hub_repo!("tasks")
    %w[/blazetrailsdev /blazetrailsdev/trails /blazetrailsdev/trails/issues /blazetrailsdev/trails/issues?state=closed
       /blazetrailsdev/trails/issues/a-two /blazetrailsdev/trails/pulls /blazetrailsdev/trails/pulls/5
       /blazetrailsdev/trails/projects /blazetrailsdev/trails/projects/0001-alpha /blazetrailsdev/trails/actions
       /blazetrailsdev/trails/wiki /blazetrailsdev/trails/pulse /blazetrailsdev/trails/settings
       /blazetrailsdev/tasks/issues].each do |path|
      get path
      assert_response :success, "#{path} answered #{response.status}"
    end
  end

  test "an unknown owner or repository is a 404" do
    require_hub!
    get "/nobody"
    assert_response :not_found
    hub_repo!("trails")
    get "/blazetrailsdev/nothing"
    assert_response :not_found
  end
end
