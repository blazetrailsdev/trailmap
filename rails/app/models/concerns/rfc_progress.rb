# How an RFC's stories are ordered and counted, on its page and on the list.
# Every rule is a port of ringo's; ../../../app/models/concerns/rfc-progress.ts
# cites each source line.
module RfcProgress
  PRIORITY_UNSET = 1_000_000
  # ringo's STORY_STATES: shipped, dead, moving, queued, stuck, not started.
  STORY_BAR_ORDER = %w[done closed in-progress claimed ready blocked draft].freeze
  STORY_BAR_MIN = 26
  STORY_BAR_MAX = 400
  # JavaScript's Number.MAX_SAFE_INTEGER, which ringo's comparator sorts an
  # unset priority as.
  MAX_SAFE_INTEGER = 2**53 - 1

  Counts = Struct.new(:total, :done, :open, :done_pct, keyword_init: true)
  StatusCount = Struct.new(:status, :count, :pct, keyword_init: true)
  BarLength = Struct.new(:pct, :clamped, keyword_init: true)

  module_function

  # In-progress first, done last. `closed` has no arm, as in ringo.
  def story_status_rank(status)
    case status
    when "in-progress" then 0
    when "claimed" then 1
    when "ready" then 2
    when "blocked" then 3
    when "draft" then 4
    when "done" then 6
    else 5
    end
  end

  # Status rank, then priority with unset last, then id in byte order.
  def order_stories_for_rfc(stories, rfc_status)
    stories.sort_by do |s|
      [ story_status_rank(EffectiveStatus.of(rfc_status, s.status)), s.priority || PRIORITY_UNSET, s.id.b ]
    end
  end

  # Total/done/open over statuses, ignoring closed ones.
  def story_counts(statuses)
    counted = statuses.reject { |s| s == "closed" }
    done = counted.count("done")
    total = counted.size
    Counts.new(total: total, done: done, open: total - done,
               done_pct: total.positive? ? (done * 100) / total : 0)
  end

  # An active RFC nothing can be picked up from.
  def stalled?(rfc_status, statuses)
    return false unless rfc_status == "active"
    return false if statuses.intersect?(%w[ready claimed in-progress])
    statuses.intersect?(%w[draft blocked])
  end

  # Statuses counted in bar order; unrecognised ones appended by name.
  def status_counts(statuses, rfc_status)
    counts = Hash.new(0)
    statuses.each { |s| counts[(EffectiveStatus.of(rfc_status, s) || "unknown").to_s] += 1 }
    known = STORY_BAR_ORDER.select { |s| counts.key?(s) }
    rest = (counts.keys - STORY_BAR_ORDER).sort
    total = statuses.size
    (known + rest).map do |status|
      count = counts[status]
      StatusCount.new(status: status, count: count, pct: total.positive? ? js_round(10_000.0 * count / total) / 100.0 : 0)
    end
  end

  # The 95th percentile of non-empty RFC story totals.
  def bar_scale(totals)
    counted = totals.select(&:positive?).sort
    return 0 if counted.empty?
    counted[[ counted.size - 1, (0.95 * counted.size).floor ].min]
  end

  # ringo's `barWidth`, as a percentage of a 400px track.
  def bar_length(total, scale)
    frac = scale.positive? ? [ 1, Math.sqrt(total) / Math.sqrt(scale) ].min : 1
    px = STORY_BAR_MIN + (STORY_BAR_MAX - STORY_BAR_MIN) * frac
    BarLength.new(pct: js_round(10_000.0 * px / STORY_BAR_MAX) / 100.0, clamped: scale.positive? && total > scale)
  end

  # Priority ascending, unset last; equal explicit priorities by fewer open
  # stories; then id.
  def order_rfcs_for_index(rfcs, open_count)
    rank = ->(r) { r.priority || MAX_SAFE_INTEGER }
    StableSort.sort(rfcs) do |a, b|
      by_priority = rank.call(a) <=> rank.call(b)
      next by_priority unless by_priority.zero?
      if a.priority && b.priority
        by_open = open_count.fetch(a.id, 0) <=> open_count.fetch(b.id, 0)
        next by_open unless by_open.zero?
      end
      LocaleCompare.compare(a.id, b.id)
    end
  end

  def terminal?(status)
    status == "closed" || status == "superseded"
  end

  # JavaScript's Math.round: half rounds toward +Infinity.
  def js_round(x)
    (x + 0.5).floor
  end
end
