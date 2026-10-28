require "test_helper"

# The parity projection: ParityMetric's arithmetic, and ParityDay's refresh
# from the stats database into the hub.
class ParityTest < ActiveSupport::TestCase
  def merged(number, sha, at)
    PullRequest.create!(number: number, merge_commit_sha: sha, merged_at: at)
  end

  test "ParityMetric.lookup, its defaults and native?" do
    api = ParityMetric.lookup("api")
    assert_equal [ "matched", "total", true ], [ api.numerator, api.denominator, api.native? ]
    files = ParityMetric.lookup("test_files")
    assert_equal [ "files_mapped", "files_total", false ], [ files.numerator, files.denominator, files.native? ]
    assert_not ParityMetric.lookup("test_assert_count").native?
    assert_nil ParityMetric.lookup("nope")
    assert_nil ParityMetric.new(key: "k", label: "l", model_name: "ApiCompareStat").gaps
  end

  test "ParityMetric#present_gaps keeps the gap columns the table has, nil for none" do
    assert_equal %w[misplaced missing], ParityMetric.lookup("api").present_gaps
    assert_nil ParityMetric.lookup("test_files").present_gaps
  end

  test "ParityMetric#measure: CI's percent for a native metric, a rounded ratio otherwise" do
    assert_equal({ matched: 3, total: 4, percent: 75.5 }, ParityMetric.lookup("api").measure("matched" => 3, "total" => 4, "percent" => 75.5))
    assert_equal({ matched: 2, total: 3, percent: 66.7 },
                 ParityMetric.lookup("test_files").measure("files_mapped" => 2, "files_total" => 3))
    assert_equal({ matched: 8, total: 10, percent: 80.0 },
                 ParityMetric.lookup("test_assert_count").measure("matched" => 10, "assertion_count_mismatch" => 2))
    assert_equal({ matched: 0, total: 0, percent: 0 }, ParityMetric.lookup("test_files").measure({}))
  end

  test "ParityDay.newest_measured_day is the newest merge a table measured" do
    merged(1, "a", "2026-01-01T09:00:00Z")
    merged(2, "b", "2026-01-03T09:00:00Z")
    ApiCompareStat.create!(merge_commit_sha: "a", pr_number: 1, package: "ar", matched: 1, total: 2, percent: 50)
    assert_equal "2026-01-01", ParityDay.newest_measured_day(ApiCompareStat)
    assert_nil ParityDay.newest_measured_day(ApiCallsStat)
  end

  test "ParityDay refreshes from stats, then answers for_chart and latest_day" do
    require_hub!
    merged(1, "a", "2026-01-01T09:00:00Z")
    merged(2, "b", "2026-01-02T09:00:00Z")
    ApiCompareStat.create!(merge_commit_sha: "a", pr_number: 1, package: "ar", matched: 1, total: 2, percent: 50, misplaced: 1, missing: 0)
    ApiCompareStat.create!(merge_commit_sha: "b", pr_number: 2, package: "ar", matched: 3, total: 4, percent: 75, misplaced: 0, missing: 1)
    assert ParityDay.stale?
    assert_equal({ ran: true, rows: 2 }, ParityDay.refresh_if_stale)
    assert_equal({ ran: false, why: "fresh" }, ParityDay.refresh_if_stale)

    rows = ParityDay.for_chart("api", [ "ar" ]).to_a
    assert_equal [ [ "2026-01-01", 1, 50.0, { "misplaced" => 1, "missing" => 0 } ], [ "2026-01-02", 2, 75.0, { "misplaced" => 0, "missing" => 1 } ] ],
                 rows.map { |r| [ r.day.iso8601, r.pr_number, r.percent, r.gaps ] }
    assert_equal [ "2026-01-02" ], ParityDay.for_chart("api", [ "ar" ], "2026-01-02").map { |r| r.day.iso8601 }
    assert_equal "2026-01-02", ParityDay.latest_day
    assert_equal({ metrics: 1, rows: 2 }, ParityDay.refresh_from_stats)
    assert_equal 2, ParityDay.where(metric: "api").count
  end
end
