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

  test "turns a tab off from the form, and the tab then 404s with no restart" do
    require_hub!
    hub_repo!("tasks")
    patch "/blazetrailsdev/tasks/settings", params: { repository_setting: { wiki_enabled: "0" } }
    assert_redirected_to "/blazetrailsdev/tasks/settings"
    assert_response :see_other
    get "/blazetrailsdev/tasks/wiki"
    assert_response :not_found
    get "/blazetrailsdev/tasks"
    assert_not_includes response.body, 'href="/blazetrailsdev/tasks/wiki"'
  end

  test "assigns only the six switches, never repository_id or id" do
    require_hub!
    tasks = hub_repo!("tasks")
    trails = hub_repo!("trails")
    row = tasks.settings
    patch "/blazetrailsdev/tasks/settings",
          params: { repository_setting: { pulls_enabled: "1", repository_id: trails.id, id: 999 } }
    assert_equal tasks.id, row.reload.repository_id
    assert_equal 1, RepositorySetting.where(repository_id: trails.id).count
  end

  test "writes a settings row on the first save of a repository without one" do
    require_hub!
    tasks = hub_repo!("tasks")
    tasks.settings.destroy!
    patch "/blazetrailsdev/tasks/settings", params: { repository_setting: { insights_enabled: "0" } }
    assert_response :see_other
    row = RepositorySetting.find_by!(repository_id: tasks.id)
    assert_equal false, row.insights_enabled
    assert_equal true, row.wiki_enabled
  end
end
