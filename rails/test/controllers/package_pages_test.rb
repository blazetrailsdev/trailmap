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
    PackageSkipTest.create!(**key, file: "packages/arel/src/a.test.ts", test_name: "forks", cited_anchor: "runtime-facts")
    [ [ "Fidelity is the job", "fidelity-is-the-job", "trails is a re-implementation" ], [ "Runtime facts", "runtime-facts", "Node has no fork" ],
      [ "Uncited", "uncited", "nobody cites this" ] ].each do |heading, anchor, lede|
      ClaudeMdSection.create!(merge_commit_sha: "sha2", pr_number: 2, file: "CLAUDE.md", heading: heading, anchor: anchor, lede: lede)
    end
    [ [ "arel/nodes/node.rb", "packages/arel/src/nodes/node.ts", 5, 1, 2, 4 ], [ "arel/nodes/binary.rb", nil, 0, 7, 0, 0 ],
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
  end

  teardown do
    [ PackageMeta, PackageTagStat, PackageTagSite, PackageMarkStat, PackageSkipTest, ClaudeMdSection, PackageFileStat ].each(&:delete_all)
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

  test "answers 404 for an unknown package" do
    get "/packages/nope/deviations"
    assert_response :not_found
  end

  test "groups Rails files by directory with port, methods, tests and open stories" do
    body = page("/packages/arel/files")
    assert_includes body, '<h2 class="section-title">arel/nodes <span class="muted">2</span>'
    assert_includes body, '<span class="muted">unported</span>'
    assert_includes body, "<td>5</td>\n        <td>1</td>\n        <td>50%</td>"
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
end
