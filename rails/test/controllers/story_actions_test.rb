require "test_helper"

# The story page's buttons, ported from ../../test/controllers/story-actions.test.ts.
class StoryActionsTest < ActionDispatch::IntegrationTest
  setup do
    Rfc.create!(id: "0001-a", status: "active", title: "A")
    { "a-draft" => "draft", "a-ready" => "ready", "a-claimed" => "claimed", "a-blocked" => "blocked", "a-done" => "done" }.each do |id, status|
      Story.create!(id: id, rfc_id: "0001-a", status: "ready")
      Story.where(id: id).update_all(status: status)
    end
  end

  def page(id)
    get "/story/#{id}"
    response.body
  end

  test "offers each button under its condition" do
    assert_includes page("a-draft"), "Mark ready"
    assert_not_includes page("a-ready"), "Mark ready"
    assert_includes page("a-claimed"), "Release claim"
    assert_not_includes page("a-blocked"), ">Block<"
    assert_not_includes page("a-done"), "Spawn worker"
    assert_includes page("a-ready"), "Spawn a worker for a-ready now, using the current loop settings?"
  end

  test "runs the verbs" do
    post "/story/a-draft/ready"
    assert_response :see_other
    assert_equal "ready", Story.find("a-draft").status
    post "/story/a-ready/top"
    assert_equal 0, Story.find("a-ready").priority
    post "/story/a-ready/block", params: { reason: "waiting" }
    assert_equal "waiting", Story.find("a-ready").blocked_by
    post "/story/a-claimed/release"
    assert_equal "ready", Story.find("a-claimed").status
  end

  test "shows the refusals" do
    post "/story/a-ready/close", params: { reason: " " }
    assert_response :unprocessable_entity
    assert_includes response.body, "close requires a reason"
    post "/story/a-done/ready"
    assert_response :conflict
    assert_includes response.body, "cannot ready it"
  end
end
