require "test_helper"

class PackagesControllerTest < ActionDispatch::IntegrationTest
  setup do
    [ [ "sha1", 1, "removed", nil ], [ "sha2", 2, "arel", "arel" ],
      [ "sha2", 2, "activerecord", "activerecord" ], [ "sha2", 2, "ruby-compat", nil ],
      [ "sha2", 2, "actionpack", "actionpack" ] ].each do |sha, pr, pkg, counterpart|
      PackageMeta.create!(merge_commit_sha: sha, pr_number: pr, package: pkg, rails_counterpart: counterpart)
    end
    ApiCompareStat.create!(merge_commit_sha: "sha1", pr_number: 1, package: "arel", matched: 1, total: 2, percent: 50)
    ApiCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "arel", matched: 9, total: 10, percent: 90)
    TestCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "arel", matched: 3, total: 4, percent: 75)
    PackageMeta.find_by!(package: "actionpack").update!(compare_keys: "actiondispatch,actioncontroller")
    ApiCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "actiondispatch", matched: 3, total: 4, percent: 75)
    ApiCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "actioncontroller", matched: 5, total: 6, percent: 83.3)
    TestCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "actiondispatch", matched: 1, total: 2, percent: 50)
    TestCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "actioncontroller", matched: 1, total: 2, percent: 50)
    TestCompareStat.create!(merge_commit_sha: "sha2", pr_number: 2, package: "ruby-compat", matched: 7, total: 8, percent: 87.5)
    rfc!("0001-wide", packages: %w[arel activerecord])
    story!("open-arel", rfc_id: "0001-wide", packages: [ "arel" ])
    story!("done-arel", rfc_id: "0001-wide", status: "done", packages: [ "arel" ])
    story!("orphan", rfc_id: "0001-wide")
  end

  teardown do
    [ PackageMeta, ApiCompareStat, TestCompareStat ].each(&:delete_all)
  end

  def group(body, title)
    start = body.index("#{title} <span")
    body[start...(body.index('<h2 class="section-title">', start) || body.size)]
  end

  test "groups the latest package_meta commit by Rails counterpart" do
    get "/packages"
    assert_response :success
    counterparts = group(response.body, "Rails counterparts")
    trails_only = group(response.body, "trails-only")
    assert_includes counterparts, 'href="/packages/arel"'
    assert_includes counterparts, 'href="/packages/activerecord"'
    assert_not_includes counterparts, "ruby-compat"
    assert_includes trails_only, 'href="/packages/ruby-compat"'
    assert_not_includes response.body, "removed"
  end

  test "shows each package's latest api and tests ratio, or no data" do
    get "/packages"
    card = ->(name) { start = response.body.index(%(href="/packages/#{name}")); response.body[start...response.body.index("</a>", start)] }
    arel = card.("arel")
    assert_includes arel, '<strong>90%</strong> <span class="muted">9 / 10</span>'
    assert_includes arel, '<strong>75%</strong> <span class="muted">3 / 4</span>'
    assert_includes arel, 'style="width:90%"'
    assert_includes arel, "1 open story"
    ar = card.("activerecord")
    assert_equal 2, ar.scan("no data").size
    assert_not_includes ar, "pkg-fill"
    assert_includes ar, "0 open stories"
  end

  test "sums a package's api and tests ratios across its compare keys" do
    get "/packages"
    start = response.body.index('href="/packages/actionpack"')
    card = response.body[start...response.body.index("</a>", start)]
    assert_includes card, '<strong>80%</strong> <span class="muted">8 / 10</span>'
    assert_includes card, '<strong>50%</strong> <span class="muted">2 / 4</span>'

    get "/packages/actionpack"
    assert_includes response.body, '<strong>80.0%</strong> <span class="muted">8 / 10</span>'
  end

  test "says a trails-only package has no Rails counterpart, and keeps its test match" do
    get "/packages"
    start = response.body.index('href="/packages/ruby-compat"')
    card = response.body[start...response.body.index("</a>", start)]
    assert_includes card, "trails-only: no Rails counterpart"
    assert_includes card, '<strong>87.5%</strong> <span class="muted">7 / 8</span>'
    assert_not_includes card, "no data"

    get "/packages/ruby-compat"
    assert_includes response.body, "trails-only: no Rails counterpart"
    assert_includes response.body, '<span class="card-title">tests</span>'
    assert_not_includes response.body, "no data"

    get "/packages/ruby-compat/files"
    assert_includes response.body, "trails-only: no Rails counterpart"
  end

  test "shows the open unattributed story count" do
    get "/packages"
    assert_includes response.body, "1 open story attributed to no package"
  end
end
