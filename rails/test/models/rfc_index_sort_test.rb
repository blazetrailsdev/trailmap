require "test_helper"

# `/rfcs?sort=<key>`: each alternate order re-sorts the priority order stably,
# so ties fall back to it. The same fixture as test/controllers/rfc-list-page.test.ts.
class RfcIndexSortTest < ActiveSupport::TestCase
  R = Struct.new(:id, :priority, :created_on)

  setup do
    @rfcs = [ R.new("0200-zeta", nil, nil), R.new("0136-trailmap", 2, "2026-01-01"), R.new("0100-alpha", 2, nil) ]
    @counts = {
      "0136-trailmap" => RfcProgress::Counts.new(total: 4, done: 1, open: 3, done_pct: 25),
      "0100-alpha" => RfcProgress::Counts.new(total: 1, done: 0, open: 1, done_pct: 0),
      "0200-zeta" => RfcProgress::Counts.new(total: 0, done: 0, open: 0, done_pct: 0)
    }
  end

  def order(sort) = RfcProgress.sort_rfcs_for_index(@rfcs, sort, @counts).map(&:id)

  test "priority is the default, and an unknown key falls back to it" do
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], order("priority")
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], order("bogus")
  end

  test "the alternate keys" do
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], order("open")
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], order("progress")
    assert_equal %w[0136-trailmap 0100-alpha 0200-zeta], order("newest")
    assert_equal %w[0100-alpha 0136-trailmap 0200-zeta], order("id")
  end
end
