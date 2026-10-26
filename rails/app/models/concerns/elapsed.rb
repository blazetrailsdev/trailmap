# Whole days between a stored date stamp and now — truncated and floored at
# zero, as ringo's Go does. Nil for an absent or unparseable stamp. A
# date-only stamp is UTC midnight, as JavaScript's `Date.parse` reads it.
module Elapsed
  def self.days_since(stamp, now: Time.now)
    at = parse(stamp.to_s)
    at && [ 0, ((now - at) / 86_400).truncate ].max
  end

  def self.parse(stamp)
    return nil if stamp.blank?
    return Time.utc(*stamp.split("-").map(&:to_i)) if stamp.match?(/\A\d{4}-\d\d-\d\d\z/)
    Time.iso8601(stamp)
  rescue ArgumentError
    Time.parse(stamp) rescue nil
  end
end
