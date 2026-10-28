require "test_helper"

# The mutation verbs over HTTP, ported from ../../test/controllers/mutations-controller.test.ts.
class MutationsControllerTest < ActionDispatch::IntegrationTest
  setup do
    rfc!("0136-trailmap")
    story!("s1", rfc_id: "0136-trailmap")
    story!("s2", rfc_id: "0136-trailmap")
    story!("taken", rfc_id: "0136-trailmap")
    Story.claim_all([ "taken" ], "someone-else")
  end

  def verb(name, body)
    post "/stories/#{name}", params: body.to_json, headers: LOOPBACK.merge("CONTENT_TYPE" => "application/json")
    JSON.parse(response.body)
  end

  test "claims a batch and reports the CLI's lines, the assignee defaulting to the first id" do
    assert_equal({ "ok" => true, "lines" => [ "claimed s1 as agent", "claimed s2 as agent" ] },
                 verb("claim", ids: %w[s1 s2], assignee: "agent"))
    assert_equal [ "claimed s1 as s1" ], verb("release", ids: [ "s1" ]).then { verb("claim", ids: [ "s1" ])["lines"] }
    assert_equal 2, Event.where(story_id: "s1", verb: "claim").count
  end

  test "a benign conflict is 409 with the CLI's exit code and message, and writes nothing" do
    body = verb("claim", ids: %w[s1 taken], assignee: "agent")
    assert_response :conflict
    assert_equal({ "ok" => false, "error" => "taken is already claimed", "exit_code" => 2 }, body)
    assert_equal "ready", Story.find("s1").status
  end

  test "an unknown id is 422 with the CLI's not-found message" do
    assert_equal "story not found: nope", verb("claim", ids: [ "nope" ])["error"]
    assert_response :unprocessable_entity
  end

  test "dedupes repeated ids" do
    assert_equal [ "claimed s1 as a" ], verb("claim", ids: %w[s1 s1], assignee: "a")["lines"]
  end

  test "release refuses what is not claimed, with the CLI's message" do
    assert_equal "s1 is ready, not claimed — nothing to release", verb("release", ids: [ "s1" ])["error"]
  end

  test "in-progress needs a qualified PR; done may omit it" do
    assert_equal "in-progress requires --pr", verb("in-progress", ids: [ "s1" ])["error"]
    assert_response :bad_request
    [ "7", "trails#07", "Trails#7", "7abc" ].each do |pr|
      assert_equal "--pr takes repo#N, e.g. trails#7228 or tasks#94", verb("done", ids: [ "s1" ], pr: pr)["error"], pr
    end
    assert_equal [ "in-progress s1 trails#7" ], verb("in-progress", ids: [ "s1" ], pr: " trails#7 ")["lines"]
    assert_equal [ "done s2" ], verb("done", ids: [ "s2" ])["lines"]
  end

  test "record-spawn takes stories or an RFC, and refuses neither" do
    assert_equal [ "recorded spawn (refine) for rfc 0136-trailmap" ], verb("record-spawn", source: "refine", rfc: "0136-trailmap")["lines"]
    assert_equal "record-spawn requires --source and either story ids or --rfc", verb("record-spawn", source: "x")["error"]
  end

  test "block, close, status-set and priority act on exactly one story" do
    assert_equal [ "blocked s1" ], verb("block", ids: [ "s1" ], reason: "waiting")["lines"]
    assert_equal "close requires a reason", verb("close", ids: [ "s1" ], reason: "  ")["error"]
    assert_equal [ "closed s1" ], verb("close", ids: [ "s1" ], reason: "dropped")["lines"]
    assert_equal [ "status ready: s2" ], verb("status-set", ids: [ "s2" ], status: "ready")["lines"]
    assert_equal %(unknown status "nope"), verb("status-set", ids: [ "s2" ], status: "nope")["error"]
    assert_equal [ "priority 3: s2" ], verb("priority", ids: [ "s2" ], priority: 3)["lines"]
    assert_equal [ "priority 4: s2" ], verb("priority", ids: [ "s2" ], priority: "4")["lines"]
    assert_equal [ "priority (clear): s2" ], verb("priority", ids: [ "s2" ], priority: "clear")["lines"]
    assert_equal %(priority must be a number or "clear"), verb("priority", ids: [ "s2" ], priority: "high")["error"]
    assert_equal "this verb takes exactly one story id", verb("block", ids: %w[s1 s2], reason: "x")["error"]
  end

  test "a batch with no ids is refused before the database" do
    assert_equal({ "ok" => false, "error" => "claim requires at least one story id", "exit_code" => 1 }, verb("claim", {}))
  end

  test "is a 404 through the proxy" do
    post "/stories/claim", params: { ids: [ "s1" ] }, headers: { "HTTP_HOST" => "trailmap.deanoftech.com" }
    assert_response :not_found
    assert_equal "ready", Story.find("s1").status
  end
end
