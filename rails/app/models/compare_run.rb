# One package's result from one comparison run on one merged trails PR. Five
# stats tables share this shape: abstract-class inheritance, not STI.
class CompareRun < Stats
  self.abstract_class = true

  # Which of these columns this table actually has — the stats schema is the
  # cron's, and may predate a counter.
  def self.present_columns(wanted)
    wanted & column_names
  end

  # Where each package stood at the end of each day: the last PR merged that
  # day, via a window function rather than SQLite's bare-column rule.
  def self.daily_rollup(packages:, columns:, since: nil)
    selected = present_columns(columns.uniq)
    inner = <<~SQL
      SELECT substr(p.merged_at, 1, 10) AS day,
             s.package, s.pr_number
             #{selected.map { |c| ", s.#{c}" }.join("\n       ")}
           , ROW_NUMBER() OVER (PARTITION BY substr(p.merged_at, 1, 10), s.package
                                ORDER BY p.merged_at DESC, s.pr_number DESC) AS rn
        FROM pull_requests p
        JOIN #{table_name} s ON s.merge_commit_sha = p.merge_commit_sha
       WHERE p.merged_at IS NOT NULL AND p.merged_at != ''
    SQL
    rollup = from("(\n#{inner}) #{table_name}").select(:day, :package, :pr_number, *selected)
                                               .where(rn: 1, package: packages).order(:day)
    since ? rollup.where("day >= ?", since) : rollup
  end
end
