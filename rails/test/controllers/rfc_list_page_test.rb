require "test_helper"

# `/rfcs`, ported from ../../test/controllers/rfc-list-page.test.ts: the title,
# the sort links, and the empty state, over the same fixture.
class RfcListPageTest < ActionDispatch::IntegrationTest
  setup do
    rfc!("0136-trailmap", title: "trailmap", owner: "dean", priority: 2, created_on: "2026-01-01", clusters: [ "pages" ])
    rfc!("0100-alpha", title: "Alpha", priority: 2)
    rfc!("0200-zeta", title: "Zeta")
    rfc!("0002-empty", status: "draft", title: "An idea")
    rfc!("0014-fixtures-adoption", status: "superseded", title: "Fixtures adoption",
                                   superseded_by: "0019-canonical-schema-burndown", created_on: "2024-01-01")
    story!("queued", rfc_id: "0136-trailmap", status: "ready")
    story!("working", rfc_id: "0136-trailmap", status: "in-progress")
    story!("stuck", rfc_id: "0136-trailmap", status: "blocked")
    story!("abandoned", rfc_id: "0136-trailmap", status: "closed")
    story!("alpha-one", rfc_id: "0100-alpha", status: "ready")
    # Last: an RFC auto-closes when every story it has is done.
    story!("shipped", rfc_id: "0136-trailmap", status: "done")
  end

  def listed(params = {})
    get "/rfcs", params: params
    assert_response :ok
    response.body.scan(%r{href="/rfc/([^"]+)"}).flatten
  end

  test "says RFCs once, with the total as a counter beside the title" do
    get "/rfcs"
    assert_match(%r{<h1 class="page-title">RFCs <span class="counter"[^>]*>5</span></h1>}, response.body)
    assert_no_match(/\d+ RFCs/, response.body)
  end

  test "renders the status tabs as an underline nav with counters" do
    get "/rfcs", params: { status: "draft" }
    assert_match(%r{class="underline-nav-item active"[^>]*aria-current="page">draft <span class="Counter">\d+</span></a>}, response.body)
  end

  test "marks the current sort, and defaults to priority" do
    get "/rfcs"
    assert_match(/<select name="sort" id="rfc-sort" class="ctl" data-sort-menu="true">/, response.body)
    assert_match(%r{<option data-href="/rfcs\?status=active"[^>]* selected="selected" value="priority">priority</option>}, response.body)
    assert_includes response.body, 'data-href="/rfcs?sort=open&amp;status=active"'
    assert_includes response.body, '<input type="hidden" name="status" value="active" autocomplete="off" />'
  end

  test "sends a no-JS submit of the default sort to the bare URL" do
    get "/rfcs", params: { status: "draft", sort: "priority" }
    assert_redirected_to "/rfcs?status=draft"
  end

  test "re-sorts by the requested key, falling back to priority order on ties" do
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], listed(sort: "open")
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], listed(sort: "progress")
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], listed(sort: "newest")
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], listed(sort: "id")
  end

  test "keeps the sort across tabs, and ignores an unknown one" do
    get "/rfcs", params: { status: "draft", sort: "open" }
    assert_includes response.body, 'href="/rfcs?sort=open&amp;status=active"'
    assert_match(%r{<option [^>]* selected="selected" value="open">most open</option>}, response.body)
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], listed(sort: "bogus")
  end

  test "says which slice is empty rather than showing a blank list" do
    get "/rfcs", params: { status: "postponed" }
    assert_includes response.body, "Nothing postponed."
  end

  test "ticks the bar at a stored refine report" do
    story!("zeta-draft", rfc_id: "0200-zeta", status: "draft")
    RfcRefinement.create!(rfc_id: "0200-zeta", outcome: "changed", created_at: Time.utc(2026, 9, 5, 10))
    story!("zeta-later", rfc_id: "0200-zeta", status: "draft")
    Event.create!(at: "2026-09-06T10:00:00Z", verb: "new", story_id: "zeta-later")
    get "/rfcs"
    row = response.body.split('<div class="item-row">').find { |r| r.include?('/rfc/0200-zeta"') }

    assert_match(/class="tick refine" style="left:[\d.]+%" title="1 story at refinement on 2026-09-05"/, row)
  end

  test "ticks a stored refine report at the story count it measured" do
    story!("zeta-draft", rfc_id: "0200-zeta", status: "draft")
    RfcRefinement.create!(rfc_id: "0200-zeta", outcome: "changed", stories: 4, created_at: Time.utc(2026, 9, 5, 10))
    get "/rfcs"
    row = response.body.split('<div class="item-row">').find { |r| r.include?('/rfc/0200-zeta"') }

    assert_match(/class="tick refine" style="left:[\d.]+%" title="4 stories at refinement on 2026-09-05"/, row)
  end
end
