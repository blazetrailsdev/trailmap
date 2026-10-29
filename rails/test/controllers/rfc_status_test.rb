require "test_helper"
require "open3"

# The lifecycle buttons over HTTP, ported from ../../test/controllers/rfc-status.test.ts.
class RfcStatusTest < ActionDispatch::IntegrationTest
  setup do
    @root = Dir.mktmpdir("rfc-status")
    @checkout = File.join(@root, "tasks")
    @origin = File.join(@root, "origin.git")
    sh("git", "init", "-q", "--bare", "-b", "main", @origin)
    sh("git", "init", "-q", "-b", "main", @checkout)
    { "0001-draft" => "draft", "0002-active" => "active", "0003-postponed" => "postponed", "0004-open" => "active",
      "0005-finished" => "active", "0006-closed" => "closed", "0007-drafts" => "active" }.each { |id, status| rfc_file!(id, status) }
    story!("open-1", rfc_id: "0004-open")
    story!("open-2", rfc_id: "0004-open", status: "done")
    # Finished without a save, or the auto-close gets there first.
    story!("gone", rfc_id: "0005-finished")
    Story.where(id: "gone").update_all(status: "closed")
    story!("d-1", rfc_id: "0007-drafts", status: "draft")
    story!("d-2", rfc_id: "0007-drafts", status: "draft")
    story!("d-3", rfc_id: "0007-drafts")
    git("add", "-A")
    git("commit", "-qm", "seed")
    git("remote", "add", "origin", @origin)
    git("push", "-q", "origin", "main")
    @was = Rails.configuration.x.tasks.dir
    Rails.configuration.x.tasks.dir = @checkout
  end

  teardown do
    Rails.configuration.x.tasks.dir = @was
    FileUtils.rm_rf(@root)
  end

  IDENT = { "GIT_AUTHOR_NAME" => "trailmap", "GIT_AUTHOR_EMAIL" => "trailmap@localhost",
            "GIT_COMMITTER_NAME" => "trailmap", "GIT_COMMITTER_EMAIL" => "trailmap@localhost" }.freeze

  def sh(*cmd)
    output, status = Open3.capture2e(*cmd)
    raise "#{cmd.join(' ')}: #{output}" unless status.success?
    output.strip
  end

  def git(*args) = sh("git", "-C", @checkout, "-c", "user.name=t", "-c", "user.email=t@t", *args)

  def rfc_file!(id, status)
    file = "rfcs/#{id}/README.md"
    FileUtils.mkdir_p(File.join(@checkout, "rfcs", id))
    File.write(File.join(@checkout, file), "---\ntitle: #{id}\nstatus: #{status}\nupdated: 2026-01-01\n---\n\n# #{id}\n")
    rfc!(id, status: status, file_path: file)
  end


  def with_env(vars)
    saved = vars.keys.to_h { |k| [ k, ENV[k] ] }
    vars.each { |k, v| ENV[k] = v }
    yield
  ensure
    saved.each { |k, v| ENV[k] = v }
  end

  def expect_moved(id, from, to)
    with_env(IDENT) { post "/rfc/#{id}/status", params: { status: to } }
    assert_response :see_other, response.body[/flash-error">([^<]*)/, 1]
    assert_includes response.location, "/rfc/#{id}"
    assert_equal to, Rfc.find(id).status
    assert_equal({ "from" => from, "to" => to, "note" => nil }, JSON.parse(Event.where(verb: "rfc-status", rfc_id: id).last.detail))
    assert_includes sh("git", "-C", @origin, "show", "main:rfcs/#{id}/README.md"), "status: #{to}"
    assert_equal "rfc(#{id}): #{from} -> #{to}", sh("git", "-C", @origin, "log", "-1", "--format=%s", "main")
  end

  test "marks a draft RFC ready" do
    expect_moved("0001-draft", "draft", "active")
  end

  test "moves an active RFC back to draft" do
    expect_moved("0002-active", "active", "draft")
  end

  test "postpones an RFC and makes a postponed one ready" do
    expect_moved("0003-postponed", "postponed", "active")
    expect_moved("0003-postponed", "active", "postponed")
  end

  test "closes an RFC whose stories are all finished" do
    expect_moved("0005-finished", "active", "closed")
  end

  test "refuses to close an RFC with open stories" do
    post "/rfc/0004-open/status", params: { status: "closed" }
    assert_response :unprocessable_entity
    assert_includes response.body, "RFC 0004-open still has 1 unfinished story (open-1) — close or rehome them first, or sunset the RFC."
    assert_equal "active", Rfc.find("0004-open").status
  end

  test "refuses a move the RFC's status does not offer" do
    post "/rfc/0006-closed/status", params: { status: "active" }
    assert_response :conflict
    assert_includes response.body, "rfc 0006-closed is &quot;closed&quot;; cannot move it to &quot;active&quot;"
  end

  test "marks every draft story ready, all or nothing" do
    post "/rfc/0007-drafts/ready-drafts"
    assert_response :see_other
    assert_equal %w[ready ready ready], Story.where(rfc_id: "0007-drafts").pluck(:status)
    post "/rfc/0007-drafts/ready-drafts"
    assert_response :conflict
    assert_includes response.body, "rfc 0007-drafts has no draft stories"
  end

  test "offers ringo's moves for the RFC's status, and none once it is closed" do
    get "/rfc/0004-open"
    %w[Back\ to\ draft Postpone Close\ RFC].each { |label| assert_includes response.body, label }
    assert_not_includes response.body, "Mark ready"
    assert_includes response.body, "Close this RFC? Refused while any of its stories are unfinished — use Sunset for that."
    get "/rfc/0006-closed"
    assert_not_includes response.body, 'class="side-section rfc-actions"'
  end
end
