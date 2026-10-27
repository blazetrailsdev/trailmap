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

  # `orDash`.
  def or_dash(s)
    s.presence || "—"
  end
end
