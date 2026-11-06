require "test_helper"

# Each packages route requested directly, through routing and the exception
# mapping, as a browser loads it.
class PackagesRequestsTest < ActionDispatch::IntegrationTest
  PACKAGE_TABLES = %w[package_meta package_tag_stats package_mark_stats package_file_stats
                      package_tag_sites package_skip_tests claude_md_sections].freeze

  setup { PackageMeta.create!(merge_commit_sha: "sha1", pr_number: 1, package: "arel", rails_counterpart: "arel") }

  teardown do
    PackageMeta.delete_all if PackageMeta.table_exists?
    Stats.connection.schema_cache.clear!
  end

  test "answers the index, linking each card to the package's page and the nav to the index" do
    get "/packages"
    assert_response :success
    assert_includes response.body, 'href="/packages/arel"'
    assert_includes response.body, '<a href="/packages">Packages</a>'
  end

  test "answers a package's page with links to its tabs" do
    get "/packages/arel"
    assert_response :success
    assert_includes response.body, 'href="/packages/arel/files"'
    assert_includes response.body, 'href="/packages/arel/deviations"'
  end

  test "answers each tab" do
    %w[/packages/arel/files /packages/arel/deviations].each do |path|
      get path
      assert_response :success, path
    end
  end

  test "answers an unknown package with a 404" do
    %w[/packages/nope /packages/nope/files /packages/nope/deviations].each do |path|
      get path
      assert_response :not_found, path
    end
  end

  # Production's STATS_DB as the trails cron fills it: the compare tables and
  # none of the package summaries, which only trailmap's stats-sync job writes.
  # Every packages page answered 500 on "no such table: package_meta". The
  # drop is rolled back with the test's transaction.
  test "answers without package tables: the index says so and a package is a 404" do
    PACKAGE_TABLES.each { |table| Stats.connection.execute("DROP TABLE #{table}") }
    Stats.connection.schema_cache.clear!

    get "/packages"
    assert_response :success
    assert_includes response.body, "No package data"
    %w[/packages/arel /packages/arel/files /packages/arel/deviations].each do |path|
      get path
      assert_response :not_found, path
    end
  end
end
