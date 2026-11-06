require "test_helper"

class PackagePagesTest < ActionDispatch::IntegrationTest
  setup do
    PackageMeta.create!(merge_commit_sha: "sha1", pr_number: 1, package: "arel")
    PackageMeta.create!(merge_commit_sha: "sha2", pr_number: 2, package: "arel")
    key = { merge_commit_sha: "sha2", pr_number: 2, package: "arel" }
    PackageTagStat.create!(**key, tag: "@noRailsEquivalent", receipt: "PERMANENT", count: 1)
    PackageTagStat.create!(**key, tag: "@perf", receipt: "none", count: 0)
    PackageTagSite.create!(**key, tag: "@noRailsEquivalent", receipt: "PERMANENT", file: "packages/arel/src/a.ts", line: 12,
                           declaration: "visit", cited_anchor: "fidelity-is-the-job")
    PackageMarkStat.create!(merge_commit_sha: "sha1", pr_number: 1, package: "arel", mark: "sends", value: 5)
    PackageMarkStat.create!(**key, mark: "sends", value: 3)
    PackageMarkStat.create!(**key, mark: "params", matched: 9, total: 10)
    [ [ 1, 0 ], [ 2, 1 ], [ 3, 32 ] ].each { |pr, value| PackageMarkStat.create!(merge_commit_sha: "sha#{pr}", pr_number: pr, package: "arel", mark: "boundary", value: value) }
    PackageTagSite.create!(**key, tag: "@noRailsEquivalent", receipt: "PERMANENT", file: "packages/arel/src/b.ts", line: 5, cited_anchor: "runtime-facts")
    PackageMeta.create!(merge_commit_sha: "sha2", pr_number: 2, package: "a_el")
    ClaudeMdSection.create!(merge_commit_sha: "sha2", pr_number: 2, file: "packages/arel/CLAUDE.md", heading: "Runtime facts in arel", anchor: "runtime-facts")
    PackageSkipTest.create!(**key, file: "packages/arel/src/a.test.ts", test_name: "forks", cited_anchor: "runtime-facts")
    [ [ "Fidelity is the job", "fidelity-is-the-job", "trails is a re-implementation" ], [ "Runtime facts", "runtime-facts", "Node has no fork" ],
      [ "Uncited", "uncited", "nobody cites this" ] ].each do |heading, anchor, lede|
      ClaudeMdSection.create!(merge_commit_sha: "sha2", pr_number: 2, file: "CLAUDE.md", heading: heading, anchor: anchor, lede: lede)
    end
    [ [ "arel/nodes/node.rb", "packages/arel/src/nodes/node.ts", 5, 1, 7, 40 ], [ "arel/nodes/binary.rb", nil, 0, 7, 0, 0 ],
      [ "arel/table.rb", "packages/arel/src/table.ts", 9, 0, 3, 3 ] ].each do |rails_file, ts_file, matched, missing, tests_matched, tests_total|
      PackageFileStat.create!(**key, rails_file: rails_file, ts_file: ts_file, methods_matched: matched, methods_missing: missing,
                              tests_matched: tests_matched, tests_total: tests_total)
    end
    rfc!("0124-arel-surfaced-deviations")
    rfc!("0023-surfaced-deviations", packages: %w[arel activerecord])
    rfc!("0001-wide", packages: %w[arel activerecord])
    story!("arel-bucket-open", rfc_id: "0124-arel-surfaced-deviations")
    story!("arel-bucket-done", rfc_id: "0124-arel-surfaced-deviations", status: "done")
    story!("catch-all-arel", rfc_id: "0023-surfaced-deviations", packages: [ "arel" ])
    story!("catch-all-ar", rfc_id: "0023-surfaced-deviations", packages: [ "activerecord" ])
    story!("open-arel", rfc_id: "0001-wide", paths: [ "packages/arel/src/nodes/node.ts" ])
    story!("done-arel", rfc_id: "0001-wide", status: "done", paths: [ "packages/arel/src/nodes/node.ts" ])
    PackageMeta.find_by(merge_commit_sha: "sha2", package: "arel")
               .update!(rails_counterpart: "arel", description: "SQL AST", claude_md: "packages/arel/CLAUDE.md")
    ApiCompareStat.create!(merge_commit_sha: "sha1", pr_number: 1, package: "arel", matched: 40, total: 100, percent: 40.0)
    ApiCompareStat.create!(**key, matched: 50, total: 100, percent: 50.0)
    TestCompareStat.create!(**key, matched: 20, total: 80, percent: 25.0, assertion_count_mismatch: 5)
    rfc!("0002-arel-only", packages: [ "arel" ])
    [ %w[arel-ready-b ready], %w[arel-ready-a ready], %w[arel-blocked blocked], %w[arel-wip in-progress], %w[arel-shipped done] ].each do |id, status|
      story!(id, rfc_id: "0002-arel-only", status: status)
    end
    [ [ "2026-11-03T10:00:00Z", "arel-shipped" ], [ "2026-11-08T10:00:00Z", "done-arel" ], [ "2026-11-10T10:00:00Z", "catch-all-ar" ] ].each do |at, id|
      Event.create!(at: at, verb: "done", story_id: id)
    end
  end

  teardown do
    [ PackageMeta, ApiCompareStat, TestCompareStat, PackageTagStat, PackageTagSite, PackageMarkStat, PackageSkipTest, ClaudeMdSection, PackageFileStat ].each(&:delete_all)
  end

  def page(path)
    get path
    assert_response :success
    response.body
  end

  test "counts receipts and links each site at the synced commit" do
    body = page("/packages/arel/deviations")
    assert_includes body, '<code>@noRailsEquivalent</code> <span class="tag">PERMANENT</span> <strong>1</strong>'
    assert_includes body, "<code>@perf</code> <strong>0</strong>"
    assert_includes body, 'href="https://github.com/blazetrailsdev/trails/blob/sha2/packages/arel/src/a.ts#L12"><code>packages/arel/src/a.ts:12</code>'
  end

  test "shows each mark's latest value with a sparkline" do
    body = page("/packages/arel/deviations")
    assert_includes body, '<code>sends</code></td><td><strong>3</strong></td><td><svg class="sparkline"'
    assert_includes body, 'points="0,0 80,16"'
    assert_includes body, "<code>params</code></td><td><strong>9 / 10</strong>"
  end

  test "groups permanent skips by cited section and lists only cited sections" do
    body = page("/packages/arel/deviations")
    assert_includes body, '<a href="#runtime-facts">runtime-facts</a> <span class="muted">1</span>'
    assert_includes body, "<code>packages/arel/src/a.test.ts</code> forks"
    assert_includes body, 'href="https://github.com/blazetrailsdev/trails/blob/sha2/CLAUDE.md#fidelity-is-the-job">Fidelity is the job</a>'
    assert_includes body, "Node has no fork"
    assert_not_includes body, "nobody cites this"
  end

  test "lists the open stories of the bucket and the catch-all attributed to the package" do
    body = page("/packages/arel/deviations")
    assert_includes body, 'href="/story/arel-bucket-open"'
    assert_includes body, 'href="/story/catch-all-arel"'
    assert_not_includes body, "arel-bucket-done"
    assert_not_includes body, 'catch-all-ar"'
  end

  test "rounds a sparkline's half-pixel boundary the same way" do
    assert_includes page("/packages/arel/deviations"), 'points="0,16 40,16 80,0"'
  end

  test "renders a NULL declaration and lede as nothing" do
    body = page("/packages/arel/deviations")
    assert_includes body, "<code>packages/arel/src/b.ts:5</code></a></li>"
    assert_includes body, '<div class="field-note"></div>'
    assert_not_includes body, "null"
  end

  test "gives a shared anchor's id to its first section only" do
    body = page("/packages/arel/deviations")
    assert_equal 1, body.scan('id="runtime-facts"').size
    assert_includes body, "Runtime facts in arel"
  end

  test "treats _ in a package name literally when matching its bucket" do
    assert_not_includes page("/packages/a_el/deviations"), "arel-bucket-open"
  end

  test "answers 404 for an unknown package" do
    get "/packages/nope/deviations"
    assert_response :not_found
  end

  test "groups Rails files by directory with port, methods, tests and open stories" do
    body = page("/packages/arel/files")
    assert_includes body, '<h2 class="section-title">arel/nodes <span class="muted">2</span>'
    assert_includes body, '<span class="muted">unported</span>'
    assert_includes body, "<td>5</td>\n        <td>1</td>\n        <td>18%</td>"
    assert_includes body, "<td>—</td>"
    assert_includes body, '<summary>1</summary><a href="/story/open-arel">open-arel</a>'
    assert_not_includes body, "done-arel"
  end

  test "sorts by missing methods or by test match" do
    by_missing = page("/packages/arel/files?sort=missing")
    assert_operator by_missing.index("binary.rb"), :<, by_missing.index("node.rb")
    assert_operator by_missing.index("node.rb"), :<, by_missing.index("table.rb")
    by_tests = page("/packages/arel/files?sort=tests")
    assert_operator by_tests.index("table.rb"), :>, by_tests.index("node.rb")
    assert_operator by_tests.index("<h2", by_tests.index("node.rb")), :>, by_tests.index("binary.rb")
  end

  test "shows counterpart, description and a tile per gate, no data where a gate has none" do
    body = page("/packages/arel")
    assert_includes body, "port of <code>arel</code>"
    assert_includes body, "SQL AST"
    assert_match %r{<span class="card-title">api</span></div>\s*<div><strong>50\.0%</strong> <span class="muted">50 / 100</span>}, body
    assert_includes body, 'points="0,16 80,0"'
    assert_includes body, '<strong>90.0%</strong> <span class="muted">9 / 10</span>'
    assert_includes body, '<strong>75.0%</strong> <span class="muted">15 / 20</span>'
    assert_equal 4, body.scan("no data").size
  end

  test "counts stories by status and lists the RFCs touching the package" do
    body = page("/packages/arel")
    assert_includes body, "ready <strong>4</strong>"
    assert_includes body, "in-progress <strong>1</strong>"
    assert_includes body, "blocked <strong>1</strong>"
    assert_includes body, "done <strong>2</strong>"
    assert_includes body, 'href="/rfc/0002-arel-only"'
    assert_includes body, 'href="/rfc/0023-surfaced-deviations"'
    assert_not_includes body, 'href="/rfc/0124-arel-surfaced-deviations"'
  end

  test "starts with three ready stories, the CLAUDE.md and the file missing most" do
    start = page("/packages/arel").then { |body| body[body.index("Start here")..] }
    assert_equal 3, start.scan('<li><a href="/story/').size
    assert_includes start, 'href="https://github.com/blazetrailsdev/trails/blob/sha2/packages/arel/CLAUDE.md"'
    assert_includes start, '<code>arel/nodes/binary.rb</code> <span class="muted">7 missing</span>'
  end

  test "answers 404 for an unknown package on the overview" do
    get "/packages/nope"
    assert_response :not_found
  end

  test "groups stories by RFC, ready first, done collapsed" do
    body = page("/packages/arel/work")
    group = body[body.index('href="/rfc/0002-arel-only"')...body.index('href="/rfc/0023')]
    positions = [ "arel-ready-a", "arel-ready-b", "arel-wip", "arel-blocked", "1 done or closed", "arel-shipped" ].map { |id| group.index(id) }
    assert positions.all?
    assert_equal positions.sort, positions
  end

  test "counts done events per week" do
    body = page("/packages/arel/work")
    assert_includes body, "<code>2026-11-02</code></td><td><strong>2</strong>"
    assert_not_includes body, "2026-11-09"
  end

  test "answers 404 for an unknown package on the work page" do
    get "/packages/nope/work"
    assert_response :not_found
  end
end
