require "test_helper"

# The RFC page's Refinements tab and the endpoint that stores its reports,
# ported from ../../test/controllers/rfc-refinements.test.ts. On Base, the
# summary attached.
class RfcRefinementsTest < ActionDispatch::IntegrationTest
  INGEST = { "HTTP_AUTHORIZATION" => "Bearer refine-test-token" }.freeze

  setup do
    @saved_token = ENV["TRAILMAP_INGEST_TOKEN"]
    ENV["TRAILMAP_INGEST_TOKEN"] = "refine-test-token"
    rfc!("0136-trailmap", title: "trailmap")
    rfc!("0002-quiet", title: "Quiet")
  end

  teardown { ENV["TRAILMAP_INGEST_TOKEN"] = @saved_token }

  def refinement!(summary, **attrs)
    RfcRefinement.create!(**attrs).tap { |r| r.summary.attach(io: StringIO.new(summary), filename: "summary.md", content_type: "text/markdown") }
  end

  def stored
    RfcRefinement.for_rfc("0136-trailmap").map { |r| [ r.outcome, r.summary.content_type, r.summary.download ] }
  end

  def report(body)
    post "/rfc-refines", params: body.to_json, headers: LOOPBACK.merge(INGEST, "CONTENT_TYPE" => "application/json")
  end

  test "shows the latest refine report, then the earlier ones newest first" do
    refinement!("first pass", rfc_id: "0136-trailmap", outcome: "no-change", created_at: Time.utc(2026, 11, 1, 9))
    refinement!("second pass", rfc_id: "0136-trailmap", outcome: "aborted", created_at: Time.utc(2026, 11, 2, 9))
    refinement!("# Report\n\nclosed **3**", rfc_id: "0136-trailmap", outcome: "changed", created_at: Time.utc(2026, 11, 3, 9, 30))

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
    refinement!("s", rfc_id: "0136-trailmap", outcome: "changed")

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
    assert_equal [ [ "changed", "text/markdown", "# Report" ] ], stored
    assert_equal 0, RfcRefinement.sole.stories
  end

  test "keeps the time an imported report gives as its created_at" do
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: "imported", when: "2026-10-01T12:00:00Z")

    assert_response :created
    assert_equal Time.utc(2026, 10, 1, 12), RfcRefinement.sole.created_at
    get "/rfc/0136-trailmap/refinements"
    assert_includes response.body, "2026-10-01 12:00 UTC"
  end

  test "stores a null summary as an empty one" do
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "no-change", summary: nil)

    assert_response :created
    assert_equal [ [ "no-change", "text/markdown", "" ] ], stored
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
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: false)
    assert_response :unprocessable_entity
    report(kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", when: "soon")
    assert_response :unprocessable_entity
    assert_equal 0, RfcRefinement.count
  end

  test "lists every report oldest first without its summary, and needs no token" do
    refinement!("later", rfc_id: "0002-quiet", outcome: "no-change", stories: 3, created_at: Time.utc(2026, 8, 2, 10))
    refinement!("earlier", rfc_id: "0002-quiet", outcome: "changed", stories: 2, created_at: Time.utc(2026, 8, 1, 10))

    get "/rfc-refines", params: { rfc: "0002-quiet" }, headers: LOOPBACK

    assert_response :ok
    assert_equal [ [ "0002-quiet", "2026-08-01T10:00:00Z", "changed", 2 ], [ "0002-quiet", "2026-08-02T10:00:00Z", "no-change", 3 ] ],
                 response.parsed_body.map { |r| r.values_at("rfc", "when", "outcome", "stories") }
  end

  test "answers the stored report for one it already has at that time" do
    report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z")
    first = response.parsed_body["id"]
    report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z")

    assert_response :ok
    assert_equal first, response.parsed_body["id"]
    assert_equal 1, RfcRefinement.count
  end

  test "answers the winner's id for a report that loses the race to the unique index" do
    report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z")
    first = response.parsed_body["id"]
    find_by = RfcRefinement.method(:find_by)
    calls = 0
    lose_the_check = ->(*args, **kwargs) { (calls += 1) == 1 ? nil : find_by.call(*args, **kwargs) }
    RfcRefinement.stub(:find_by, lose_the_check) do
      report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z")
    end

    assert_response :ok
    assert_equal first, response.parsed_body["id"]
    assert_equal 1, RfcRefinement.count
  end

  test "answers 500 for a report without a when that collides with a stored one" do
    refinement!("a", rfc_id: "0002-quiet", outcome: "changed", created_at: Time.utc(2026, 8, 1, 10))

    travel_to(Time.utc(2026, 8, 1, 10)) { report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "b") }

    assert_response :internal_server_error
    assert_equal "internal_server_error", response.parsed_body["error"]
    assert_equal 1, RfcRefinement.count
  end

  test "keeps an imported stories count, zero included, and refuses one that is not a non-negative integer" do
    report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z", stories: 0)
    assert_response :created
    assert_equal 0, RfcRefinement.last.stories

    [ -1, 1.5, "3" ].each do |bad|
      report(kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", stories: bad)
      assert_response :unprocessable_entity
    end
  end
end
