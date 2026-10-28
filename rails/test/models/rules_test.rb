require "test_helper"

# The pure rules the pages are built from — each a port of ringo's, so the
# pinned values are ringo's values.
class RulesTest < ActiveSupport::TestCase
  test "story status rank: in-progress first, done last, closed on the default arm" do
    assert_equal [ 0, 1, 2, 3, 4, 5, 6, 5 ],
                 [ "in-progress", "claimed", "ready", "blocked", "draft", "closed", "done", nil ].map { RfcProgress.story_status_rank(_1) }
  end

  test "story counts leave closed out of the denominator, floored" do
    c = RfcProgress.story_counts(%w[done done ready closed draft blocked])
    assert_equal [ 5, 2, 3, 40 ], [ c.total, c.done, c.open, c.done_pct ]
    assert_equal 0, RfcProgress.story_counts([]).done_pct
  end

  test "an RFC is stalled with nothing ready or in flight and work waiting" do
    assert RfcProgress.stalled?("active", %w[draft done])
    assert_not RfcProgress.stalled?("active", %w[draft ready])
    assert_not RfcProgress.stalled?("draft", %w[draft])
    assert_not RfcProgress.stalled?("active", %w[done])
  end

  test "the bar counts in bar order, effective statuses, unknowns appended" do
    counts = RfcProgress.status_counts([ "ready", "done", "weird", "closed", "ready" ], "draft")
    assert_equal [ [ "done", 1, 20.0 ], [ "closed", 1, 20.0 ], [ "draft", 2, 40.0 ], [ "weird", 1, 20.0 ] ],
                 counts.map { [ _1.status, _1.count, _1.pct ] }
    assert_equal 33.33, RfcProgress.status_counts(%w[a b c], "active").first.pct
  end

  test "the bar scale is the 95th percentile of non-empty totals" do
    assert_equal 0, RfcProgress.bar_scale([ 0, 0 ])
    assert_equal 20, RfcProgress.bar_scale((1..20).to_a)
    assert_equal 96, RfcProgress.bar_scale((1..100).to_a)
  end

  test "bar length: square-root scale with a floor, clamped above the scale" do
    assert_equal [ 100.0, false ], RfcProgress.bar_length(100, 100).to_h.values
    assert_equal [ 6.5, false ], RfcProgress.bar_length(0, 100).to_h.values
    assert RfcProgress.bar_length(400, 100).clamped
  end

  test "RFC list order: priority, then fewer open among equal explicit priorities, then id" do
    r = Struct.new(:id, :priority)
    rfcs = [ r.new("c", nil), r.new("b", 1), r.new("a", 1), r.new("d", nil) ]
    assert_equal %w[b a c d], RfcProgress.order_rfcs_for_index(rfcs, { "a" => 5, "b" => 1 }).map(&:id)
  end

  test "backlog tabs partition draft and icebox, judged by the parent RFC" do
    row = ->(status, rfc) { Backlog::Row.new(id: "x", rfc_id: rfc, status: status) }
    rfc_status = { "live" => "active", "idea" => "draft" }
    assert Backlog.matches?(row.call("draft", "live"), "draft", rfc_status)
    assert_not Backlog.matches?(row.call("draft", "idea"), "draft", rfc_status)
    assert Backlog.matches?(row.call("draft", "idea"), "icebox", rfc_status)
    assert_not Backlog.matches?(row.call("done", "idea"), "icebox", rfc_status)
    assert_not Backlog.matches?(row.call("ready", "idea"), "open", rfc_status)
  end

  test "backlog order: status group, then queue position, then id" do
    row = ->(id, status) { Backlog::Row.new(id: id, rfc_id: "r", status: status) }
    rows = [ row.call("z", "ready"), row.call("b", "done"), row.call("a", "ready"), row.call("q", "ready"), row.call("i", "in-progress") ]
    assert_equal %w[i q a z b], Backlog.order(rows, { "q" => 0 }).map(&:id)
  end

  test "lifecycle errors, in validate-lib's exact voice" do
    s = Struct.new(:status, :claim_at, :assignee, :pr, :blocked_by, :closed_reason, :est_loc, keyword_init: true)
    assert_equal [ %(status: ready must have null assignee (got "a")) ],
                 SemanticValidation.lifecycle_errors(s.new(status: "ready", assignee: "a"))
    assert_equal [ "status: in-progress requires a claim timestamp", "status: in-progress requires an assignee",
                   "status: in-progress requires a pr" ], SemanticValidation.lifecycle_errors(s.new(status: "in-progress"))
    assert_equal [ %(blocked-by is set but status is "done" — only blocked stories carry blocked-by) ],
                 SemanticValidation.lifecycle_errors(s.new(status: "done", blocked_by: "x"))
    assert_equal [ "est-loc 701 exceeds the 700 LOC per-PR ceiling" ], SemanticValidation.est_loc_errors(s.new(status: "ready", est_loc: 701))
    assert_empty SemanticValidation.est_loc_errors(s.new(status: "done", est_loc: 9000))
  end

  test "the dep graph reports missing refs and cycles" do
    deps = { "a" => %w[b], "b" => %w[a], "c" => %w[nope] }
    v = SemanticValidation.check_dep_graph(story_ids: Set["a", "b", "c"], rfc_ids: Set[], deps_of: ->(id) { deps.fetch(id, []) },
                                           deps_rfc_of: ->(id) { id == "c" ? [ "0000-x" ] : [] }, seeds: %w[a b c])
    assert_equal [ %(dep "nope" does not exist), %(deps-rfc "0000-x" does not exist), "dep cycle detected: a → b → a" ],
                 SemanticValidation.dep_graph_messages(v)
  end

  test "frontmatter is stripped as ringo strips it" do
    assert_equal "body", Document.strip_frontmatter("---\ntitle: x\n---\nbody")
    assert_equal "---\nonly opens", Document.strip_frontmatter("---\nonly opens")
    assert_equal "", Document.strip_frontmatter("---\na: b\n---")
    assert_equal "body", Document.strip_frontmatter("﻿---\na: b\n---\nbody\n")
  end

  test "days since a stamp truncates, floors at zero, and reads dates as UTC midnight" do
    now = Time.utc(2026, 9, 10, 12)
    assert_equal 4, Elapsed.days_since("2026-09-06", now: now)
    assert_equal 0, Elapsed.days_since("2026-09-11", now: now)
    assert_nil Elapsed.days_since("not a date", now: now)
    assert_nil Elapsed.days_since(nil, now: now)
  end

  test "the RFC marks: baseline, first-day burst and refinements" do
    e = ->(at, verb, story, rfc = nil, detail = nil) { RfcMarks::MarkEvent.new(at: at, verb: verb, story_id: story, rfc_id: rfc, detail: detail) }
    events = [ e.call("2026-01-01T00:00:00Z", "new", "s2"), e.call("2026-01-05T00:00:00Z", "spawn", nil, "r", { source: "rfc-refine" }.to_json),
               e.call("2026-01-06T00:00:00Z", "spawn", nil, "r", { source: "rfc-refine" }.to_json) ]
    marks = RfcMarks.collect(Set["r"], { "s1" => "r", "s2" => "r" }, events)["r"]
    assert_equal [ [ nil, 1, "origin", 1 ], [ "2026-01-05T00:00:00Z", 2, "refine", 2 ] ], marks.map { _1.to_h.values }
    assert_equal "2 stories at refinement on 2026-01-05 (2 refinements, unchanged)", RfcMarks.title(marks.last)
  end

  test "locale compare sorts as JavaScript's localeCompare" do
    # The orders below are Node 24's `["…"].sort((a, b) => a.localeCompare(b))`.
    assert_equal %w[a_b a-b a.b ab aB b B], %w[B b aB ab a.b a-b a_b].sort { LocaleCompare.compare(_1, _2) }
    js = [ "-a", "0", "9", "a", "A", "a b", "a@b", "a/b", "a#b", "a+b", "a~b", "a$b", "e", "éclair", "f",
           "x_1", "x-1", "x.1", "x1", "X1", "x10", "x2", "zeta", "Zeta" ]
    assert_equal js, js.reverse.sort { LocaleCompare.compare(_1, _2) }
  end

  test "a stable sort keeps ties in input order, as JavaScript's does" do
    assert_equal %w[b1 b2 a1 a2], StableSort.sort(%w[b1 a1 b2 a2]) { |x, y| y[0] <=> x[0] }
  end
end
