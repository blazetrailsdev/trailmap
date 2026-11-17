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

  test "marks the current sort, and defaults to priority" do
    get "/rfcs"
    assert_match(/<select id="rfc-sort" name="sort"/, response.body)
    assert_match(%r{<option value="priority" data-href="/rfcs\?status=active"[^>]* selected>priority</option>}, response.body)
    assert_includes response.body, 'data-href="/rfcs?sort=open&amp;status=active"'
    assert_includes response.body, '<input type="hidden" name="status" value="active">'
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
    assert_match(%r{<option value="open"[^>]* selected>most open</option>}, response.body)
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], listed(sort: "bogus")
  end

  test "says which slice is empty rather than showing a blank list" do
    get "/rfcs", params: { status: "postponed" }
    assert_includes response.body, "Nothing postponed."
  end
end
