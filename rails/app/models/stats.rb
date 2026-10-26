# The base class of the trails comparison stats: the read-only database the
# nightly stats-sync cron fills. Optional — without STATS_DB the parity page
# says so.
class Stats < ApplicationRecord
  self.abstract_class = true

  connects_to database: { writing: :stats, reading: :stats }

  # Whether STATS_DB names a database to read. The test environment always has
  # its own scratch copy.
  def self.configured?
    Rails.env.test? || ENV["STATS_DB"].present?
  end
end
