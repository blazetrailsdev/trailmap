# The history ticks on an RFC's story bar — ringo's `collectRFCMarks`
# (webhook/rfcmarks.go), reconstructed from the event stream.
module RfcMarks
  Mark = Struct.new(:at, :count, :kind, :reps, keyword_init: true)
  MarkEvent = Struct.new(:at, :verb, :story_id, :rfc_id, :detail, keyword_init: true)

  REFINE_SOURCES = %w[rfc-refine rfc-refine-auto].freeze

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

  # `events` in the order they happened.
  def collect(known, story_rfc, events)
    created = events.select { |e| e.verb == "new" }.map(&:story_id).to_set
    baseline = Hash.new(0)
    story_rfc.each { |id, rfc| baseline[rfc] += 1 if !created.include?(id) && known.include?(rfc) }

    running = baseline.dup
    first_day = {}
    first_burst = Hash.new(0)
    refines = Hash.new { |h, k| h[k] = [] }
    events.each do |e|
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

    known.each_with_object({}) do |rfc, out|
      count = [ baseline[rfc], first_burst[rfc] ].find(&:positive?) || 0
      later = refines.key?(rfc) ? refines[rfc] : []
      next if count.zero? && later.empty?
      out[rfc] = [ Mark.new(at: nil, count: count, kind: "origin", reps: 1), *later ]
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
