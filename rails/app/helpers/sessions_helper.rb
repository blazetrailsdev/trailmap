# The archive pages' formatting, each one ringo's helper of the same name
# (`webhook/sessionarchive_page.go`).
module SessionsHelper
  MONTHS = %w[Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec].freeze

  # Go's `Jan 2 15:04` of an RFC 3339 time as ringo marshalled it: the wall
  # clock in the offset ringo wrote, so the cell reads as ringo's does.
  def session_time(at)
    m = /\A\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.match(at.to_s)
    m ? "#{MONTHS[m[1].to_i - 1]} #{m[2].to_i} #{m[3]}:#{m[4]}" : at
  end

  # `shortDur`: `<1m`, `42m`, `3h05m`.
  def short_dur(ms)
    return "<1m" if ms < 60_000
    h = ms / 3_600_000
    m = (ms / 60_000) % 60
    h.zero? ? "#{m}m" : format("%dh%02dm", h, m)
  end

  # `money`: a dash for nothing, else dollars to the cent. Rounded from the
  # float's exact binary value, as JavaScript's `toFixed` does: Ruby's `%.2f`
  # rounds 1.255 up to 1.26, where the trails app writes 1.25.
  def money(v)
    v.zero? ? "—" : format("$%.2f", v.to_r.round(2))
  end

  # `humanBytes`.
  def human_bytes(n)
    return format("%.1f GB", n / 2.0**30) if n >= 2**30
    return format("%.1f MB", n / 2.0**20) if n >= 2**20
    return format("%.1f KB", n / 2.0**10) if n >= 2**10
    "#{n} B"
  end

  # `shortID`.
  def short_id(id)
    id.length > 12 ? "#{id[0, 12]}…" : id
  end

  # Go's `15:04:05` of an RFC 3339 time, in the offset it was written in.
  # Empty for Go's zero time.
  def clock(at)
    at.start_with?("0001-") ? "" : at[11, 8]
  end

  # `ToolCall.Duration`, in ms: zero when the call never answered.
  def call_ms(call)
    return 0 if call["StartedAt"].start_with?("0001-") || call["EndedAt"].start_with?("0001-")
    [ epoch_ms(call["EndedAt"]) - epoch_ms(call["StartedAt"]), 0 ].max
  end

  # `Transcript.Duration`, in ms.
  def wall_ms(tr)
    epoch_ms(tr["LastAt"]) - epoch_ms(tr["FirstAt"])
  end

  # `toolDur`: `30ms`, `1.5s`, `10m00s`; empty for nothing. Rounded as
  # `toFixed` rounds, for the reason `money` gives.
  def tool_dur(ms)
    return "" if ms <= 0
    return "#{ms.to_i}ms" if ms < 1000
    return format("%.1fs", (ms / 1000.0).to_r.round(1)) if ms < 60_000
    format("%dm%02ds", ms.to_i / 60_000, (ms.to_i / 1000) % 60)
  end

  # `clip`: the first `max` bytes, as Go slices, and how much was left out.
  def clip(s, max)
    return s if s.bytesize <= max
    "#{s.byteslice(0, max).scrub("\uFFFD")}\n… clipped, #{human_bytes(s.bytesize - max)} more"
  end

  # `core.FirstLine`: the first line, at most 96 bytes, with " …" when cut.
  def first_line(s)
    line, nl, = s.partition("\n")
    line = line.strip
    cut = !nl.empty?
    if line.bytesize > 96
      line = line.byteslice(0, 96).scrub("\uFFFD").strip
      cut = true
    end
    cut ? "#{line} …" : line
  end

  # `plural`.
  def plural(n, one, many)
    n == 1 ? one : many
  end

  # `prFromCWD(cwd) > 0`: a session run from a review checkout reviewed the PR.
  def reviewed_from(cwd)
    m = %r{review[^/]*/(?:[^/]+/)*pr-(\d+)(?:/|\z)}i.match(cwd)
    !m.nil? && m[1].to_i.positive?
  end

  # `orDash`.
  def or_dash(s)
    s.presence || "—"
  end

  private

  def epoch_ms(at)
    (Time.iso8601(at).to_r * 1000).floor
  end
end
