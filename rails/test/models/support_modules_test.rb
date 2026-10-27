require "test_helper"

# Direct tests for the small modules and readers the page tests reach only
# through a caller.
class SupportModulesTest < ActiveSupport::TestCase
  def with_audits(files)
    Dir.mktmpdir do |dir|
      files.each_with_index do |(name, body), i|
        path = File.join(dir, name)
        name.end_with?("/") ? Dir.mkdir(path) : File.write(path, body)
        File.utime(Time.at(1_000_000 + i), Time.at(1_000_000 + i), path)
      end
      previous = Rails.configuration.x.audits.dir
      Rails.configuration.x.audits.dir = "#{dir}/"
      yield dir
    ensure
      Rails.configuration.x.audits.dir = previous
    end
  end

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

  test "Audit.all is newest first, skipping directories and other names; first, find_by and find" do
    with_audits("old.md" => "# Old", "new.html" => "<p>n</p>", "notes.txt" => "x", "dir.md/" => nil) do |dir|
      assert_equal dir, Audit.dir
      assert_equal %w[new.html old.md], Audit.all.map(&:name)
      assert_equal "new.html", Audit.first.name
      assert_equal "old.md", Audit.find_by(name: "old.md").name
      assert_nil Audit.find_by(name: "../etc/passwd")
      assert_raises(ActiveRecord::RecordNotFound) { Audit.find("gone.md") }
      audit = Audit.find("old.md")
      assert_equal [ "old.md", "old", false, "# Old" ], [ audit.id, audit.title, audit.html?, audit.read ]
      assert Audit.find("new.html").html?
      File.delete(File.join(dir, "old.md"))
      assert_raises(ActiveRecord::RecordNotFound) { audit.read }
    end
  end

  test "Audit.all is empty with no directory configured" do
    previous = Rails.configuration.x.audits.dir
    Rails.configuration.x.audits.dir = nil
    assert_equal [], Audit.all
    assert_raises(ActiveRecord::RecordNotFound) { Audit.new(name: "x.md").read }
  ensure
    Rails.configuration.x.audits.dir = previous
  end
end
