require "test_helper"
require "support/stand_in_ringo"
require "open3"

# The actions the page smoke test does not request: one audit and its raw
# file, a deploy log, the probes, and the parity chart's data.
class EndpointsTest < ActionDispatch::IntegrationTest
  include StandInRingo

  def with_config(node, key, value)
    holder = Rails.configuration.x.public_send(node)
    previous = holder.public_send(key)
    holder.public_send(:"#{key}=", value)
    yield
  ensure
    holder.public_send(:"#{key}=", previous)
  end

  # ── audits ──

  test "audits show renders one audit inline; raw serves it sandboxed" do
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, "sweep-20261027T101500Z.md"), "---\na: b\n---\n# Sweep\n\nfound *it*")
      File.write(File.join(dir, "page.html"), "<p>hi</p>")
      with_config(:audits, :dir, dir) do
        get "/audits/sweep-20261027T101500Z.md"
        assert_response :success
        assert_includes response.body, "<em>it</em>"

        get "/audits/sweep-20261027T101500Z.md/raw"
        assert_response :success
        assert_equal "sandbox", response.headers["Content-Security-Policy"]
        assert_includes response.body, "<em>it</em>"
        assert_not_includes response.body, "a: b"

        get "/audits/page.html/raw"
        assert_equal "<p>hi</p>", response.body

        get "/audits/missing.md"
        assert_response :not_found
      end
    end
  end

  # ── deploys ──

  test "deploys log relays ringo's log and status" do
    with_ringo({ "/deploys/log?id=run%201" => [ 200, "line one\n" ] }) do
      get "/deploys/log", params: { id: "run 1" }
      assert_response :success
      assert_equal "line one\n", response.body
      get "/deploys/log"
      assert_response :not_found
    end
    without_ringo { get "/deploys/log", params: { id: "x" } }
    assert_response :service_unavailable
  end

  # ── probes ──

  test "ready is ok with a database, stories, migrations and a writable checkout" do
    rfc!("0001-a")
    story!("s", rfc_id: "0001-a")
    Dir.mktmpdir do |dir|
      Open3.capture2e("git", "init", "-q", dir)
      Open3.capture2e("git", "-C", dir, "config", "user.name", "T")
      Open3.capture2e("git", "-C", dir, "config", "user.email", "t@example.com")
      with_config(:tasks, :dir, dir) { get "/up/ready", headers: LOOPBACK }
    end
    body = JSON.parse(response.body)
    assert_response :success, body.inspect
    assert_equal({ "status" => "ok", "failing" => [] }, body.slice("status", "failing"))
    assert_equal 1, body.dig("checks", "stories", "count")
  end

  test "ready sweeps a probe directory orphaned by a kill, but not a concurrent one" do
    Dir.mktmpdir do |dir|
      Open3.capture2e("git", "init", "-q", dir)
      Dir.mkdir(old = File.join(dir, ".up-ready-killed"))
      Dir.mkdir(File.join(dir, ".up-ready-running"))
      File.utime(10.minutes.ago.to_time, 10.minutes.ago.to_time, old)
      with_config(:tasks, :dir, dir) { get "/up/ready", headers: LOOPBACK }
      assert_equal true, JSON.parse(response.body).dig("checks", "checkout", "ok")
      assert_equal %w[.up-ready-running], Dir.glob(".up-ready-*", base: dir)
    end
  end

  test "ready goes red when the database file was replaced after the connection opened it" do
    Dir.mktmpdir do |dir|
      file = File.join(dir, "replaced.db")
      File.write(file, "opened")
      TasksDatabase.record!(file)
      File.write("#{file}.restored", "restored")
      File.rename("#{file}.restored", file)
      ENV["TASKS_DATABASE"] = file
      get "/up/ready", headers: LOOPBACK
      assert_match(/replaced\.db was replaced: the connection opened dev \d+ ino \d+, and the path is now dev \d+ ino \d+/,
                   JSON.parse(response.body).dig("checks", "database", "error"))
    end
  ensure
    ENV.delete("TASKS_DATABASE")
    TasksDatabase.identity = nil
  end

  test "ready goes red on the hub head alone when its last migration did not run" do
    require_hub!
    head = Hub.connection_pool.migration_context.migrations.last.version
    Hub.connection.execute("DELETE FROM schema_migrations WHERE version = '#{head}'")
    get "/up/ready", headers: LOOPBACK
    check = JSON.parse(response.body).dig("checks", "hub_migrations")
    assert_equal false, check["ok"]
    assert_match(/and db\/hub-migrate expects #{head}: a migration did not run/, check["error"])
  ensure
    Hub.connection.execute("INSERT INTO schema_migrations (version) VALUES ('#{head}')") if head
  end

  test "ready names each failing check" do
    with_config(:tasks, :dir, "/nonexistent/tasks") { get "/up/ready", headers: LOOPBACK }
    assert_response :service_unavailable
    body = JSON.parse(response.body)
    assert_equal %w[stories checkout git_identity], body["failing"]
    assert_equal "the stories table is empty", body.dig("checks", "stories", "error")
  end

  test "deep answers the queue's size, and down past its bound" do
    Story.stub(:ready_queue, [ [ 1, 2 ], nil ]) { get "/up/deep", headers: LOOPBACK }
    assert_response :success
    assert_equal "ok", JSON.parse(response.body)["status"]
    assert_equal 2, JSON.parse(response.body).dig("ready", "rows")

    previous = ProbesController.deep_timeout
    ProbesController.deep_timeout = 0.05
    slow = -> { sleep 0.3; [ [], nil ] }
    Story.stub(:ready_queue, slow) { get "/up/deep", headers: LOOPBACK }
    assert_response :service_unavailable
    assert_match(/\Atimeout: /, JSON.parse(response.body)["error"])
  ensure
    ProbesController.deep_timeout = previous if previous
    ProbesController.in_flight&.join
  end

  test "the probes answer loopback only" do
    get "/up/ready"
    assert_response :not_found
  end

  # ── parity data ──

  test "parity data refuses an unknown metric or too many packages" do
    get "/graphs/parity/data", params: { metric: "nope" }
    assert_equal({ "error" => "unknown metric nope" }, JSON.parse(response.body))
    get "/graphs/parity/data", params: { packages: (1..9).map { "p#{_1}" }.join(",") }
    assert_equal({ "error" => "at most 8 packages at a time" }, JSON.parse(response.body))
  end

  test "parity data says the projection is empty" do
    get "/graphs/parity/data"
    assert_response :success
    assert_match(/\AThe parity projection is empty/, JSON.parse(response.body)["error"])
  end

  test "parity data charts the refreshed projection in ringo's shape" do
    require_hub!
    PullRequest.create!(number: 1, merge_commit_sha: "a", merged_at: "2026-01-01T09:00:00Z")
    ApiCompareStat.create!(merge_commit_sha: "a", pr_number: 1, package: "ar", matched: 1, total: 2, percent: 50, misplaced: 1, missing: 0)
    get "/graphs/parity/data", params: { packages: "ar,zz", days: "all" }
    body = JSON.parse(response.body)
    assert_equal [ "api" ], body["metrics_selected"]
    assert_equal({ "api" => %w[misplaced missing] }, body["gaps_by_metric"])
    assert_equal [ "ar" ], body["packages"]
    assert_equal [ "zz" ], body["unknown_packages"]
    assert_equal [ { "metric" => "api", "package" => "ar", "points" => [
      { "date" => "2026-01-01", "pr" => 1, "percent" => 50, "matched" => 1, "total" => 2, "gaps" => { "misplaced" => 1, "missing" => 0 } }
    ] } ], body["series"]
  end
end
