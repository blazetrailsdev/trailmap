require "test_helper"

# The small pure functions the pages and JSON are built from, each pinned to
# the value the trails app produces.
class PureHelpersTest < ActiveSupport::TestCase
  include ApplicationHelper
  include DeploysHelper

  test "LoopbackOnly.strip_port drops a port from a name, IPv4 and bracketed IPv6" do
    assert_equal "127.0.0.1", LoopbackOnly.strip_port("127.0.0.1:3000")
    assert_equal "localhost", LoopbackOnly.strip_port("localhost")
    assert_equal "[::1]", LoopbackOnly.strip_port("[::1]:3000")
    assert_equal "::1", LoopbackOnly.strip_port("::1")
  end

  test "status_word is the status, or unknown when blank" do
    assert_equal "ready", status_word(" ready ")
    assert_equal "unknown", status_word("")
    assert_equal "unknown", status_word(nil)
  end

  test "js_num prints a whole float as JavaScript does" do
    assert_equal "50", js_num(50.0)
    assert_equal "12.5", js_num(12.5)
    assert_equal 7, js_num(7)
  end

  test "deploy_duration" do
    assert_equal "42s", deploy_duration(42)
    assert_equal "2m 5s", deploy_duration(125)
  end

  test "JsonArray.load answers [] for null, junk and non-arrays" do
    assert_equal [ "a" ], JsonArray.load('["a"]')
    assert_equal [], JsonArray.load(nil)
    assert_equal [], JsonArray.load("not json")
    assert_equal [], JsonArray.load('{"a":1}')
  end

  test "JsonArray.dump writes nil as []" do
    assert_equal '["a"]', JsonArray.dump([ "a" ])
    assert_equal "[]", JsonArray.dump(nil)
  end

  test "Fleet.pane_id? takes up to ten digits only" do
    assert Fleet.pane_id?("42")
    assert_not Fleet.pane_id?("%42")
    assert_not Fleet.pane_id?("12345678901")
  end

  test "Fleet.screen_hash? caps the length" do
    assert Fleet.screen_hash?("a" * Fleet::SCREEN_HASH_MAX)
    assert_not Fleet.screen_hash?("a" * (Fleet::SCREEN_HASH_MAX + 1))
  end

  test "StoryJson.iso_midnight reads a date and drops junk" do
    assert_equal "2026-01-02T00:00:00.000Z", StoryJson.iso_midnight("2026-01-02")
    assert_equal "2026-01-02T00:00:00.000Z", StoryJson.iso_midnight("2026-01-02T15:00:00Z")
    assert_nil StoryJson.iso_midnight("")
    assert_nil StoryJson.iso_midnight(nil)
    assert_nil StoryJson.iso_midnight("garbage")
  end

  test "StoryJson.integer_or_nil" do
    assert_equal 3, StoryJson.integer_or_nil(3)
    assert_nil StoryJson.integer_or_nil("3")
    assert_nil StoryJson.integer_or_nil(nil)
  end

  test "ParityJson.js_number" do
    assert_equal 93, ParityJson.js_number(93.0)
    assert_kind_of Integer, ParityJson.js_number("93")
    assert_equal 92.5, ParityJson.js_number(92.5)
  end

  test "ParityJson.series groups by package in the caller's order, gaps only when present" do
    row = Struct.new(:day, :pr_number, :percent, :matched, :total, :gaps, :package)
    rows = [
      row.new(Date.new(2026, 1, 1), 5, 50.0, 1, 2, nil, "b"),
      row.new(Date.new(2026, 1, 1), 5, 25.5, 1, 4, [ "x" ], "a")
    ]
    assert_equal [
      { metric: "api", package: "a", points: [ { date: "2026-01-01", pr: 5, percent: 25.5, matched: 1, total: 4, gaps: [ "x" ] } ] },
      { metric: "api", package: "b", points: [ { date: "2026-01-01", pr: 5, percent: 50, matched: 1, total: 2 } ] }
    ], ParityJson.series(rows, "api", %w[a c b])
  end
end
