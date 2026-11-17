require "test_helper"

# The RFC page's Refinements tab and the endpoint that stores its reports,
# ported from ../../test/controllers/rfc-refinements.test.ts.
class RfcRefinementsTest < ActionDispatch::IntegrationTest
  setup do
    require_hub!
    rfc!("0136-trailmap", title: "trailmap")
    rfc!("0002-quiet", title: "Quiet")
  end

  def report(body)
    post "/rfc-refines", params: body.to_json, headers: LOOPBACK.merge("CONTENT_TYPE" => "application/json")
  end

  test "shows the latest refine report, then the earlier ones newest first" do
    RfcRefine.create!(rfc_id: "0136-trailmap", outcome: "no-change", summary: "first pass", created_at: Time.utc(2026, 11, 1, 9))
    RfcRefine.create!(rfc_id: "0136-trailmap", outcome: "aborted", summary: "second pass", created_at: Time.utc(2026, 11, 2, 9))
    RfcRefine.create!(rfc_id: "0136-trailmap", outcome: "changed", summary: "# Report\n\nclosed **3**",
                      created_at: Time.utc(2026, 11, 3, 9, 30))

    get "/rfc/0136-trailmap/refinements"

    assert_response :ok
    assert_match %r{class="tab active" href="/rfc/0136-trailmap/refinements" aria-current="page">Refinements <span class="Counter">3</span>},
                 response.body
    assert_includes response.body, '<span class="Label refine-changed">changed</span>'
    assert_includes response.body, "2026-11-03 09:30 UTC"
    assert_includes response.body, "<strong>3</strong>"
    assert_includes response.body, "Earlier reports"
    assert_operator response.body.index("second pass"), :<, response.body.index("first pass")
    assert_not_includes response.body, "No refine report yet"
  end

  test "says there is no refine report yet when there is none" do
    get "/rfc/0002-quiet/refinements"

    assert_response :ok
    assert_includes response.body, "No refine report yet. Run “Refine stories”"
    assert_includes response.body, 'Refinements <span class="Counter">0</span>'
    assert_not_includes response.body, "Earlier reports"
  end

  test "counts the reports on the Stories tab too" do
    RfcRefine.create!(rfc_id: "0136-trailmap", outcome: "changed", summary: "s")

    get "/rfc/0136-trailmap"

    assert_match %r{class="tab active" href="/rfc/0136-trailmap" aria-current="page">Stories <span class="Counter">0</span>}, response.body
    assert_includes response.body, '<a class="tab" href="/rfc/0136-trailmap/refinements">Refinements <span class="Counter">1</span></a>'
  end

  test "answers 404 for an unknown id on the Refinements tab" do
    get "/rfc/9999-nope/refinements"

    assert_response :not_found
    assert_includes response.body, "9999-nope"
  end

  test "stores a refine report posted as kind=rfc-refine" do
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", pane: "%404", summary: "# Report")

    assert_response :created
    assert_equal "changed", response.parsed_body["outcome"]
    assert_equal [ [ "changed", "# Report" ] ], RfcRefine.for_rfc("0136-trailmap").pluck(:outcome, :summary)
  end

  test "refuses a report for an unknown RFC, another kind, an unknown outcome, or a summary that is not a string" do
    report(kind: "rfc-refine", id: "9999-nope", outcome: "changed")
    assert_response :not_found
    report(kind: "story", id: "0136-trailmap", outcome: "changed")
    assert_response :bad_request
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "maybe")
    assert_response :unprocessable_entity
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: { a: 1 })
    assert_response :unprocessable_entity
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: [ "a" ])
    assert_response :unprocessable_entity
    assert_equal 0, RfcRefine.count
  end
end
