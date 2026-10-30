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
      "0005-finished" => "active", "0006-closed" => "closed", "0007-drafts" => "active",
      "0008-finished-parked" => "postponed", "0009-blank-reason" => "draft", "0010-hooked" => "draft",
      "0012-conflict" => "draft", "0015-csrf" => "draft", "0016-quiet" => "active" }.each { |id, status| rfc_file!(id, status) }
    rfc_file!("0011-listy", "draft", "updated:\n  - 2026-01-01")
    story!("open-1", rfc_id: "0004-open")
    story!("open-2", rfc_id: "0004-open", status: "done")
    # Finished without a save, or the auto-close gets there first.
    story!("gone", rfc_id: "0005-finished")
    Story.where(id: "gone").update_all(status: "closed")
    story!("parked-done", rfc_id: "0008-finished-parked")
    Story.where(id: "parked-done").update_all(status: "done")
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

  def rfc_file!(id, status, updated = "updated: 2026-01-01")
    file = "rfcs/#{id}/README.md"
    FileUtils.mkdir_p(File.join(@checkout, "rfcs", id))
    File.write(File.join(@checkout, file), "---\ntitle: #{id}\nstatus: #{status}\n#{updated}\n---\n\n# #{id}\n")
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
    assert_not_includes response.body, ">Lifecycle<"
    assert_not_includes response.body, "Spawn batch"
    assert_not_includes response.body, "Sunset RFC"
  end

  test "relays Spawn batch and Sunset to ringo, with ringo's payload and confirm text" do
    get "/rfc/0004-open"
    body = response.body
    assert_includes body, 'data-relay="spawnloop/rfc-batch-spawn"'
    assert_includes body, 'data-payload="{&quot;slug&quot;:&quot;0004-open&quot;}"'
    assert_includes body, "Spawn one worker for the next batch of stories under 0004-open?"
    assert_includes body, 'data-relay="spawnloop/rfc-refine"'
    assert_includes body, "&quot;mode&quot;:&quot;sunset&quot;"
    assert_includes body, "Sunset 0004-open? An agent will re-home its remaining stories and close the RFC unless work is still in flight."
  end

  test "offers no batch with nothing claimable, and no sunset unless the RFC is active" do
    get "/rfc/0016-quiet"
    assert_not_includes response.body, "Spawn batch"
    assert_includes response.body, "Sunset RFC"
    get "/rfc/0003-postponed"
    assert_not_includes response.body, "Sunset RFC"
  end

  test "offers Refine stories with ringo's note and confirm text on any RFC" do
    get "/rfc/0003-postponed"
    assert_includes response.body, "data-relay-note"
    assert_includes response.body, "&quot;mode&quot;:&quot;refine&quot;"
    assert_includes response.body, "Spawn an agent to groom every story under 0003-postponed?"
    assert_includes response.body, "Refine stories"
  end

  test "writes a blank reason as no note" do
    with_env(IDENT) { post "/rfc/0009-blank-reason/status", params: { status: "active", reason: "   " } }
    assert_nil JSON.parse(Event.where(verb: "rfc-status", rfc_id: "0009-blank-reason").last.detail)["note"]
  end

  test "puts the file back when the commit fails" do
    hook = File.join(@checkout, ".git/hooks/pre-commit")
    File.write(hook, "#!/bin/sh\nexit 1\n")
    File.chmod(0o755, hook)
    with_env(IDENT) { post "/rfc/0010-hooked/status", params: { status: "active" } }
    assert_response :unprocessable_entity
    assert_includes response.body, "rfc-status could not commit rfcs/0010-hooked/README.md"
    File.delete(hook)
    assert_equal "", sh("git", "-C", @checkout, "status", "--porcelain")
    assert_equal "draft", Rfc.find("0010-hooked").status
  end

  test "closes a readied RFC whose stories are all finished, as ingest does" do
    with_env(IDENT) { post "/rfc/0008-finished-parked/status", params: { status: "active" } }
    assert_response :see_other
    assert_equal "closed", Rfc.find("0008-finished-parked").status
  end

  test "refuses to edit a list-valued frontmatter key, and leaves the file alone" do
    post "/rfc/0011-listy/status", params: { status: "active" }
    assert_response :unprocessable_entity
    assert_includes response.body, "refusing to edit list-valued frontmatter key &quot;updated&quot; in rfcs/0011-listy/README.md"
    assert_equal "", sh("git", "-C", @checkout, "status", "--porcelain")
    assert_equal "draft", Rfc.find("0011-listy").status
  end

  test "refuses a POST without the authenticity token button_to writes, and takes one with it" do
    was = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    get "/rfc/0015-csrf"
    token = response.body[/name="authenticity_token" value="([^"]+)"/, 1]
    assert token
    post "/rfc/0015-csrf/status", params: { status: "active" }
    assert_response :unprocessable_entity
    assert_equal "draft", Rfc.find("0015-csrf").status
    with_env(IDENT) { post "/rfc/0015-csrf/status", params: { status: "active", authenticity_token: token } }
    assert_response :see_other
    assert_equal "active", Rfc.find("0015-csrf").status
  ensure
    ActionController::Base.allow_forgery_protection = was
  end

  test "aborts a rebase that conflicts, so the next click is not refused" do
    other = File.join(@root, "other")
    sh("git", "clone", "-q", @origin, other)
    path = File.join(other, "rfcs/0012-conflict/README.md")
    File.write(path, File.read(path).sub("status: draft", "status: postponed"))
    sh("git", "-C", other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "theirs")
    sh("git", "-C", other, "push", "-q", "origin", "main")
    with_env(IDENT) { post "/rfc/0012-conflict/status", params: { status: "active" } }
    assert_response :see_other
    assert_equal "main", sh("git", "-C", @checkout, "rev-parse", "--abbrev-ref", "HEAD")
    assert_equal "", sh("git", "-C", @checkout, "status", "--porcelain")
  end
end
