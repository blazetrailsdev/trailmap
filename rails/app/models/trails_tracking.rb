# What `pnpm trails:status` last said about the tasks CLI's trails, as the tasks
# repo's scripts/track-trails-cron.sh writes it after every hourly run: to
# trails-status.txt beside tasks.db. nil without a tasks database or a run.
module TrailsTracking
  def self.status
    db = ENV["TASKS_DATABASE"].to_s.strip
    return nil if db.empty?
    File.read(File.join(File.dirname(db), "trails-status.txt"), encoding: "UTF-8").rstrip
  rescue Errno::ENOENT
    nil
  end

  # `trails:status` escalates a pin held too long with an `ERROR:` line.
  def self.failing?(status) = status.match?(/^ERROR:/)
end
