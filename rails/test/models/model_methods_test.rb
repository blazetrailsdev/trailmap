require "test_helper"

# Direct tests for the model and concern methods the page and rule tests
# reach only through a caller.
class ModelMethodsTest < ActiveSupport::TestCase
  def with_config(path, value)
    node = Rails.configuration.x.public_send(path.first)
    previous = node.public_send(path.last)
    node.public_send(:"#{path.last}=", value)
    yield
  ensure
    node.public_send(:"#{path.last}=", previous)
  end

  def seed(id, rfc_id, status, **attrs)
    Story.create!(id: id, rfc_id: rfc_id, status: "draft", **attrs)
    Story.where(id: id).update_all(status: status)
  end

  # ── Audit ──

  test "Audit.title_for drops the extension and timestamp and de-kebabs" do
    assert_equal "parity sweep", Audit.title_for("parity-sweep-20261027T101500Z.md")
    assert_equal "a b", Audit.title_for("a_b.html")
    assert_equal "-20261027T101500Z.md", Audit.title_for("-20261027T101500Z.md")
  end

  test "Audit#to_param and #persisted?" do
    audit = Audit.new(name: "x.md")
    assert_equal "x.md", audit.to_param
    assert audit.persisted?
  end

  # ── CompareRun ──

  test "CompareRun.present_columns keeps only columns the table has" do
    assert_equal %w[misplaced missing], ApiCompareStat.present_columns(%w[misplaced nope missing])
    assert_equal %w[missing], ApiComparePrivatesStat.present_columns(%w[misplaced missing])
  end

  test "CompareRun.daily_rollup keeps each day's last merge per package" do
    PullRequest.create!(number: 1, merge_commit_sha: "a", merged_at: "2026-01-01T09:00:00Z")
    PullRequest.create!(number: 2, merge_commit_sha: "b", merged_at: "2026-01-01T18:00:00Z")
    PullRequest.create!(number: 3, merge_commit_sha: "c", merged_at: "2026-01-02T09:00:00Z")
    PullRequest.create!(number: 4, merge_commit_sha: "d", merged_at: "")
    { "a" => 10, "b" => 20, "c" => 30, "d" => 40 }.each_with_index do |(sha, matched), i|
      ApiCompareStat.create!(merge_commit_sha: sha, pr_number: i + 1, package: "ar", matched: matched, total: 100, percent: matched)
    end
    ApiCompareStat.create!(merge_commit_sha: "a", pr_number: 1, package: "other", matched: 1, total: 1, percent: 100)
    rows = ApiCompareStat.daily_rollup(packages: [ "ar" ], columns: %w[matched nope]).to_a
    assert_equal [ [ "2026-01-01", 2, 20 ], [ "2026-01-02", 3, 30 ] ], rows.map { |r| [ r.day, r.pr_number, r.matched ] }
    assert_equal [ "2026-01-02" ], ApiCompareStat.daily_rollup(packages: [ "ar" ], columns: %w[matched], since: "2026-01-02").map(&:day)
  end

  # ── Backlog, DepGraph, Pager ──

  test "Backlog.iceboxed? judges by the parent RFC" do
    story = Struct.new(:rfc_id).new("r")
    assert Backlog.iceboxed?(story, { "r" => "draft" })
    assert Backlog.iceboxed?(story, { "r" => "postponed" })
    assert_not Backlog.iceboxed?(story, { "r" => "active" })
    assert_not Backlog.iceboxed?(story, {})
  end

  test "DepGraph.walk goes level by level, records via, and notices a cycle" do
    rfc!("0001-a")
    story!("c", rfc_id: "0001-a")
    story!("b", rfc_id: "0001-a", deps: [ "c" ])
    story!("a", rfc_id: "0001-a", deps: [ "b" ])
    StoryDep.create!(story_id: "c", depends_on_id: "a")
    up = DepGraph.walk("a", :blocked_by)
    assert_equal [ [ "b", 1, nil ], [ "c", 2, "b" ] ], up[:reached].map { |r| [ r[:id], r[:depth], r[:via] ] }
    assert up[:cyclic]
    down = DepGraph.walk("c", :blocks)
    assert_equal [ [ "b", 1, nil ], [ "a", 2, "b" ] ], down[:reached].map { |r| [ r[:id], r[:depth], r[:via] ] }
  end

  test "Pager.requested_page takes digits only" do
    assert_equal 3, Pager.requested_page("3")
    assert_equal 1, Pager.requested_page("3a")
    assert_equal 1, Pager.requested_page(nil)
    assert_equal 1, Pager.requested_page([ "2" ])
  end

  # ── Document ──

  test "Document.tasks_content_dir: TASKS_DIR, else above TASKS_DATABASE's .git, else nil" do
    previous = ENV["TASKS_DATABASE"]
    with_config(%i[tasks dir], "/w/tasks//") { assert_equal "/w/tasks", Document.tasks_content_dir }
    with_config(%i[tasks dir], "") do
      ENV["TASKS_DATABASE"] = "/w/tasks/.git/tasks.db"
      assert_equal "/w/tasks", Document.tasks_content_dir
      ENV["TASKS_DATABASE"] = "/tmp/tasks.db"
      assert_nil Document.tasks_content_dir
    end
  ensure
    ENV["TASKS_DATABASE"] = previous
  end

  test "Document.node_style_message reads as Node's fs error" do
    error = Errno::ENOENT.new("/w/x.md")
    assert_equal "ENOENT: no such file or directory, open '/w/x.md'", Document.node_style_message(error, "/w/x.md")
  end

  # ── Ranking ──

  test "Ranking.bundle_scope, next_bundle_in and stories_touching_in over one index" do
    rfc!("0136-t")
    seed("x", "0136-t", "ready", cluster: "c1", est_loc: 300)
    seed("y", "0136-t", "ready", cluster: "c2", est_loc: 100)
    StoryPath.create!(story_id: "x", path: "app/models/story.ts")
    index = Story.ranking_index
    assert_equal %w[x], Ranking.bundle_scope(index, cluster: "c1").map(&:id)
    assert_equal %w[x y], Ranking.bundle_scope(index).map(&:id).sort
    assert_equal %w[x], Ranking.next_bundle_in(index, max_loc: 700).map(&:id)
    assert_equal %w[x], Ranking.stories_touching_in(index, "./app/models").map(&:id)
    assert_equal [], Ranking.stories_touching_in(index, "lib")
  end

  # ── RfcClose ──

  test "RfcClose.close_if_complete closes an active RFC whose stories are all terminal" do
    rfc!("0005-x")
    seed("s1", "0005-x", "done")
    seed("s2", "0005-x", "in-progress")
    assert_not RfcClose.close_if_complete("0005-x")
    Story.where(id: "s2").update_all(status: "closed")
    assert RfcClose.close_if_complete("0005-x")
    assert_equal "closed", Rfc.find("0005-x").status
    assert_equal "rfc-close", Event.where(rfc_id: "0005-x").pick(:verb)
    assert_not RfcClose.close_if_complete("0005-x")
    assert_not RfcClose.close_if_complete(nil)
    rfc!("0006-empty")
    assert_not RfcClose.close_if_complete("0006-empty")
  end

  # ── RfcMarks ──

  test "RfcMarks.spawn_source reads source, then arg" do
    assert_equal "rfc-refine", RfcMarks.spawn_source({ source: "rfc-refine", arg: "x" }.to_json)
    assert_equal "x", RfcMarks.spawn_source({ arg: "x" }.to_json)
    assert_equal "", RfcMarks.spawn_source("[1]")
    assert_equal "", RfcMarks.spawn_source("junk")
    assert_equal "", RfcMarks.spawn_source(nil)
  end

  test "RfcMarks.utc_day converts an offset, and keeps the prefix of anything else" do
    assert_equal "2026-01-02", RfcMarks.utc_day("2026-01-01T22:00:00-04:00")
    assert_equal "2026-01-01", RfcMarks.utc_day("2026-01-01T22:00:00Z")
    assert_equal "2026-01-01", RfcMarks.utc_day("2026-01-01 22:00")
  end

  # ── RfcProgress ──

  test "RfcProgress.order_stories_for_rfc: status rank, priority unset last, id by bytes" do
    s = Struct.new(:id, :status, :priority)
    stories = [ s.new("b", "ready", nil), s.new("a", "ready", nil), s.new("c", "ready", 2), s.new("d", "in-progress", nil), s.new("e", "done", 1) ]
    assert_equal %w[d c a b e], RfcProgress.order_stories_for_rfc(stories, "active").map(&:id)
  end

  test "RfcProgress.js_round rounds half up, as Math.round" do
    assert_equal 3, RfcProgress.js_round(2.5)
    assert_equal(-2, RfcProgress.js_round(-2.5))
    assert_equal 2, RfcProgress.js_round(2.4)
  end

  # ── Search ──

  test "Search.phrase trims, collapses and bounds, nil when too short" do
    assert_equal "has many", Search.phrase("  has \n many ")
    assert_nil Search.phrase("a")
    assert_nil Search.phrase(nil)
    assert_equal 100, Search.phrase("x" * 200).length
  end

  test "Search over ids, titles and bodies, with snippets" do
    Dir.mktmpdir do |dir|
      File.write(File.join(dir, "s.md"), "---\nid: s\n---\nThe serializer serializes. serialize twice.")
      with_config(%i[tasks dir], dir) do
        rfc!("0007-serialize", title: "Serialize everything")
        story!("plain", rfc_id: "0007-serialize", title: "Plain", file_path: "s.md")
        story!("title_hit", rfc_id: "0007-serialize", title: "a serialize title")

        assert_equal Set["rfc:0007-serialize", "story:title_hit"], Search.title_matches("SERIALIZE")
        assert_equal Set[], Search.title_matches("%")
        assert_equal %w[rfc:0007-serialize story:plain story:title_hit], Search.all_rows.map { |r| "#{r.kind}:#{r.id}" }.sort
        Story.where(id: "plain").update_all(body: "The serializer serializes. serialize twice.")
        assert_equal({ "story:plain" => 3 }, Search.body_mentions("SERIALIZ"))

        hits = Search.search("serialize")
        assert_equal [ [ "0007-serialize", 1 ], [ "title_hit", 2 ], [ "plain", 3 ] ], hits.map { |h| [ h.id, h.tier ] }
        snipped = Search.with_snippets(hits, "serialize")
        assert_equal "", snipped.first.snippet
        assert_equal "The serializer serializes. serialize twice.", snipped.last.snippet
      end
    end
  end

  test "Search.snippet_of clips to the context with ellipses" do
    text = "#{'a ' * 60}needle#{' b' * 60}"
    snippet = Search.snippet_of(text, "needle")
    assert snippet.start_with?("…")
    assert snippet.end_with?("…")
    assert_includes snippet, "needle"
    assert_equal "", Search.snippet_of("nothing here", "needle")
    assert_equal "a needle b", Search.snippet_of("a needle b", "needle")
  end

  # ── SemanticValidation ──

  test "SemanticValidation.terminal_status?" do
    assert SemanticValidation.terminal_status?("done")
    assert SemanticValidation.terminal_status?("closed")
    assert_not SemanticValidation.terminal_status?("ready")
  end

  test "SemanticValidation.closed_rfc_errors names each open story of a closed RFC" do
    s = Struct.new(:id, :status)
    stories = [ s.new("a", "done"), s.new("b", "ready") ]
    assert_equal [ %(status: closed but story "b" is "ready", not done or closed) ],
                 SemanticValidation.closed_rfc_errors(Struct.new(:status).new("closed"), stories)
    assert_equal [], SemanticValidation.closed_rfc_errors(Struct.new(:status).new("active"), stories)
  end

  # ── Story and Rfc ──

  test "Story and Rfc hold the update touch to updated_at, leaving the markdown dates" do
    rfc = rfc!("0008-t", updated_on: "2026-01-01")
    story = story!("held", rfc_id: "0008-t", updated_on: "2026-01-01")
    assert_equal [ "updated_at" ], Story.send(:timestamp_attributes_for_update)
    assert_equal [ "updated_at" ], Rfc.send(:timestamp_attributes_for_update)
    assert_equal [ "created_at" ], Rfc.send(:timestamp_attributes_for_create)
    story.update!(title: "changed")
    rfc.update!(title: "changed")
    assert_equal "2026-01-01", story.reload.updated_on.to_s
    assert_equal "2026-01-01", rfc.reload.updated_on.to_s
  end

  test "Story#close_rfc_if_complete runs only for a landing" do
    rfc!("0009-t")
    story = story!("only", rfc_id: "0009-t", status: "in-progress", pr: "trails#1", assignee: "a", claim_at: "2026-01-01T00:00:00Z")
    story.close_rfc_if_complete
    assert_equal "active", Rfc.find("0009-t").status
    Story.where(id: "only").update_all(status: "done")
    story.reload.close_rfc_if_complete
    assert_equal "closed", Rfc.find("0009-t").status
  end

  test "Story.semantic_errors collects row, graph and RFC errors" do
    rfc!("0010-t", status: "closed")
    seed("bad", "0010-t", "ready", assignee: "someone")
    StoryDep.insert_all!([ { story_id: "bad", depends_on_id: "ghost" } ])
    errors = Story.semantic_errors
    assert_includes errors, %(status: ready must have null assignee (got "someone"))
    assert_includes errors, %(dep "ghost" does not exist)
    assert_includes errors, %(status: closed but story "bad" is "ready", not done or closed)
  end

  test "Story.bundle_outline builds rows, not records" do
    rfc!("0011-t")
    seed("o", "0011-t", "ready", est_loc: 5)
    outline = Story.bundle_outline
    assert_equal [ "o" ], outline.stories.map(&:id)
    assert_not_kind_of Story, outline.stories.first
  end

  test "Story.now_iso and Story.today are UTC" do
    assert_match(/\A\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\z/, Story.now_iso)
    assert_equal Time.now.utc.to_date.iso8601, Story.today
  end

  # ── Setting, VerbExit, SessionArchive ──

  test "Setting.lookup and ringo_base fall back to the environment and trim the slash" do
    previous = ENV["RINGO_BASE"]
    ENV["RINGO_BASE"] = " http://ringo:8080// "
    Setting.forget_resolved
    assert_equal "http://ringo:8080//", Setting.lookup("ringo_base")
    assert_equal "http://ringo:8080", Setting.ringo_base
    ENV["RINGO_BASE"] = ""
    Setting.forget_resolved
    assert_nil Setting.lookup("ringo_base")
    assert_nil Setting.ringo_base
  ensure
    ENV["RINGO_BASE"] = previous
    Setting.forget_resolved
  end

  test "VerbExit carries its exit code" do
    error = VerbExit.new(2, "held by someone else")
    assert_equal [ 2, "held by someone else" ], [ error.code, error.message ]
  end

  test "SessionArchive.new defaults the optional fields" do
    archive = SessionArchive.new(owner: "o", repo: "r", pr: "3", pane: "%1")
    assert_equal [ 3, "", "", 0, false ], [ archive.pr, archive.branch, archive.pane_log, archive.pane_log_bytes, archive.truncated ]
  end

  test "SessionArchive::Unavailable carries a status" do
    error = SessionArchive::Unavailable.new("down", 502)
    assert_equal [ "down", 502 ], [ error.message, error.status ]
  end
end
