require "test_helper"

# Direct tests for the small modules and readers the page tests reach only
# through a caller.
class SupportModulesTest < ActiveSupport::TestCase
  test "Fleet::Sse.data splits complete events and keeps the rest, including half a CRLF" do
    assert_equal [ [ "one", "two\nlines" ], "data: thr" ], Fleet::Sse.data("data: one\n\nevent: x\ndata: two\ndata:lines\n\ndata: thr")
    assert_equal [ [ "a" ], "\r" ], Fleet::Sse.data("data: a\r\n\r\n\r")
    assert_equal [ [], "" ], Fleet::Sse.data(": comment\n\n")
  end

  test "EffectiveStatus.of: ready under a non-active RFC reads draft" do
    assert_equal "draft", EffectiveStatus.of("draft", "ready")
    assert_equal "draft", EffectiveStatus.of(nil, "ready")
    assert_equal "ready", EffectiveStatus.of("active", "ready")
    assert_equal "done", EffectiveStatus.of("draft", "done")
  end

  test "Elapsed.parse reads a date as UTC midnight, an RFC 3339 time, or nil" do
    assert_equal Time.utc(2026, 9, 6), Elapsed.parse("2026-09-06")
    assert_equal Time.utc(2026, 9, 6, 4), Elapsed.parse("2026-09-06T00:00:00-04:00")
    assert_nil Elapsed.parse("")
    assert_nil Elapsed.parse("not a date")
  end

  test "LocaleCompare.key folds case and accents into one primary weight" do
    assert_equal LocaleCompare.key("abc"), LocaleCompare.key("ABC")
    assert_equal LocaleCompare.key("e"), LocaleCompare.key("é")
    assert_equal(-1, LocaleCompare.key("a") <=> LocaleCompare.key("b"))
  end

  test "Meta.get and Meta.set" do
    assert_nil Meta.get("last_ingested_sha")
    Meta.set("last_ingested_sha", "abc")
    Meta.set("last_ingested_sha", "def")
    assert_equal "def", Meta.get("last_ingested_sha")
  end

  test "RfcJson.serialize and serialize_all, in index.json's field order" do
    rfc = rfc!("0001-a", priority: 2, packages: [ "ar" ], created_on: "2026-01-02")
    json = RfcJson.serialize(rfc)
    assert_equal %i[id title status priority owner created updated packages clusters superseded_by related_rfcs file_path], json.keys
    assert_equal [ 2, "2026-01-02T00:00:00.000Z", nil, [ "ar" ] ], json.values_at(:priority, :created, :updated, :packages)
    assert_equal [ json ], RfcJson.serialize_all([ rfc ])
  end

  test "Stats.configured? is always true under test" do
    assert Stats.configured?
  end

  test "Pager.for clamps the page and builds the neighbours' links" do
    pager = Pager.for(45, 20, 9) { |n| "?page=#{n}" }
    assert_equal [ 3, 3, 45, 41, 45, "?page=2", nil ], pager.to_a
    first = Pager.for(0, 20, 0) { |n| "?page=#{n}" }
    assert_equal [ 1, 1, 0, 0, 0, nil, nil ], first.to_a
  end

  test "Backlog.filter?" do
    assert Backlog.filter?("icebox")
    assert_not Backlog.filter?("closed")
  end

  test "ParityMetric#model, #columns and #available?" do
    api = ParityMetric.lookup("api")
    assert_equal ApiCompareStat, api.model
    assert_equal %w[matched total percent], api.columns
    assert_equal %w[matched assertion_count_mismatch], ParityMetric.lookup("test_assert_count").columns
    assert api.available?
  end

  test "Audit.newest_first, find by the legacy filename, and read" do
    old = audit!("old", "md", "# Old", Time.utc(2026, 10, 1))
    audit!("new", "html", "<p>n</p>", Time.utc(2026, 10, 2))
    assert_equal %w[new-20261002T000000Z.html old-20261001T000000Z.md], Audit.newest_first.map(&:to_param)
    assert_equal old, Audit.find("old-20261001T000000Z.md")
    assert_raises(ActiveRecord::RecordNotFound) { Audit.find("gone-20261001T000000Z.md") }
    assert_raises(ActiveRecord::RecordNotFound) { Audit.find("../etc/passwd") }
    assert_equal [ false, "# Old", 5 ], [ old.html?, old.read, old.size ]
    assert Audit.find("new-20261002T000000Z.html").html?
  end

  def audit!(slug, format, body, written_at)
    Audit.create!(slug: slug, title: slug, format: format, written_at: written_at).tap do |audit|
      audit.body.attach(io: StringIO.new(body), filename: "#{slug}.#{format}")
    end
  end
end
