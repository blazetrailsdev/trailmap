# The history ticks on an RFC's story bar — ringo's `collectRFCMarks`
# (webhook/rfcmarks.go), reconstructed from the event stream, with the stored
# refine reports folded in as ringo's `mergeRefineHistory` folds its own. A hub
# report records no story count, so its count is the RFC's running count at
# the report's time.
module RfcMarks
  Mark = Struct.new(:at, :count, :kind, :reps, keyword_init: true)
  MarkEvent = Struct.new(:at, :verb, :story_id, :rfc_id, :detail, keyword_init: true)

  RefineReport = Struct.new(:at, :rfc_id, keyword_init: true)

  REFINE_SOURCES = %w[rfc-refine rfc-refine-auto].freeze
  # A report within this of a reconstructed refinement is that refinement (rfcmarks.go:47).
  REFINE_WINDOW = 6 * 60 * 60

  module_function

  def spawn_source(detail)
    parsed = JSON.parse(detail.to_s)
    return "" unless parsed.is_a?(Hash)
    (parsed["source"].presence || parsed["arg"].presence || "").to_s
  rescue JSON::ParserError
    ""
  end

  # The UTC day; `at` carries offsets. RFC 3339 only, as Go's parse is.
  def utc_day(at)
    return at[0, 10] unless at.match?(/\A\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)\z/)
    Time.iso8601(at).utc.strftime("%Y-%m-%d")
  rescue ArgumentError
    at[0, 10]
  end

  def parse_time(at)
    Time.iso8601(at.to_s)
  rescue ArgumentError
    nil
  end

  # Origin first, then on the `at` string, stable, as ringo's `collapseRFCMarks`
  # sorts (rfcmarks.go:341); consecutive refinements at one count are one tick.
  def collapse(marks)
    sorted = marks.each_with_index.sort_by do |m, i|
      [ m.kind == "origin" ? 0 : 1, m.kind == "origin" ? "" : m.at.to_s, i ]
    end.map(&:first)
    sorted.each_with_object([]) do |m, out|
      last = out.last
      if last && m.kind == "refine" && last.kind == "refine" && last.count == m.count
        last.reps += m.reps
      else
        out << m.dup
      end
    end
  end

  # A report replaces the count of the nearest refinement in the window, else is its own tick.
  def merge_refine_history(marks, history)
    out = marks.map(&:dup)
    history.each do |rep|
      next if rep[:count] <= 0 || (wh = parse_time(rep[:at])).nil?
      best, best_gap = nil, 0
      out.each_with_index do |m, i|
        next unless m.kind == "refine"
        t = parse_time(m.at) or next
        gap = (wh - t).abs
        best, best_gap = i, gap if gap <= REFINE_WINDOW && (best.nil? || gap < best_gap)
      end
      if best
        out[best].count = rep[:count]
      else
        out << Mark.new(at: wh.utc.iso8601, count: rep[:count], kind: "refine", reps: 1)
      end
    end
    collapse(out)
  end

  # `events` in the order they happened; `reports` in any order.
  def collect(known, story_rfc, events, reports = [])
    created = events.select { |e| e.verb == "new" }.map(&:story_id).to_set
    baseline = Hash.new(0)
    story_rfc.each { |id, rfc| baseline[rfc] += 1 if !created.include?(id) && known.include?(rfc) }

    running = baseline.dup
    first_day = {}
    first_burst = Hash.new(0)
    refines = Hash.new { |h, k| h[k] = [] }
    pending = reports.select { |r| known.include?(r.rfc_id) && parse_time(r.at) }.each_with_index.sort_by { |r, i| [ parse_time(r.at), i ] }.map(&:first)
    history = Hash.new { |h, k| h[k] = [] }
    record_until = lambda do |at|
      while pending.any? && (at.nil? || parse_time(pending.first.at) < at)
        r = pending.shift
        history[r.rfc_id] << { at: r.at, count: running[r.rfc_id] }
      end
    end
    events.each do |e|
      record_until.call(parse_time(e.at) || Time.at(0))
      via_story = e.story_id && story_rfc[e.story_id]
      rfc = via_story && known.include?(via_story) ? via_story : e.rfc_id
      next if rfc.nil? || !known.include?(rfc)
      if e.verb == "new"
        running[rfc] += 1
        day = utc_day(e.at)
        first_day[rfc] ||= day
        first_burst[rfc] += 1 if first_day[rfc] == day
      elsif e.verb == "spawn" && e.story_id.blank?
        source = spawn_source(e.detail)
        next if source != "" && !REFINE_SOURCES.include?(source)
        marks = refines[rfc]
        count = running[rfc]
        if marks.last&.count == count
          marks.last.reps += 1
        else
          marks << Mark.new(at: e.at, count: count, kind: "refine", reps: 1)
        end
      end
    end

    record_until.call(nil)

    known.each_with_object({}) do |rfc, out|
      count = [ baseline[rfc], first_burst[rfc] ].find(&:positive?) || 0
      later = refines.key?(rfc) ? refines[rfc] : []
      reported = history.key?(rfc) ? history[rfc] : []
      next if count.zero? && later.empty? && reported.empty?
      marks = [ Mark.new(at: nil, count: count, kind: "origin", reps: 1), *later ]
      out[rfc] = reported.empty? ? marks : merge_refine_history(marks, reported)
    end
  end

  # What a tick is, in words, since a 2px line cannot say.
  def title(mark)
    n = "#{mark.count} #{mark.count == 1 ? 'story' : 'stories'}"
    return "#{n} when the RFC was written" if mark.kind == "origin"
    reps = mark.reps > 1 ? " (#{mark.reps} refinements, unchanged)" : ""
    "#{n} at refinement on #{mark.at.to_s[0, 10]}#{reps}"
  end
end
