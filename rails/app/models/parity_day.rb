# Where one package stood under one comparison run, at the end of one day.
# A PROJECTION of the stats database into the hub; rows are already measured.
class ParityDay < Hub
  BATCH = 500

  # The advisory lock key for a refresh.
  REFRESH_LOCK = 0x7a11_0001

  def self.for_chart(metric_key, packages, since = nil)
    rel = where(metric: metric_key, package: packages).order(:day)
    since ? rel.where("day >= ?", since) : rel
  end

  def self.latest_day
    maximum(:day)&.iso8601
  end

  # Rebuild the projection, replacing each metric's rows in one transaction.
  def self.refresh_from_stats
    rows = 0
    metrics = 0
    ParityMetric.all.each do |metric|
      packages = metric.model.distinct.pluck(:package).select(&:present?)
      next if packages.empty?
      gaps = metric.present_gaps || []
      rolled = metric.model.daily_rollup(packages: packages, columns: metric.columns + gaps).to_a
      next if rolled.empty?

      now = Time.current
      records = rolled.map do |r|
        attrs = r.attributes
        metric.measure(attrs).merge(
          metric: metric.key, package: attrs["package"], day: attrs["day"], pr_number: attrs["pr_number"].to_i,
          gaps: gaps.any? ? gaps.to_h { |g| [ g, attrs[g].to_i ] } : nil, created_at: now, updated_at: now
        )
      end
      transaction do
        where(metric: metric.key).delete_all
        records.each_slice(BATCH) { |batch| insert_all!(batch) }
      end
      metrics += 1
      rows += records.size
    end
    { metrics: metrics, rows: rows }
  end

  # Whether the projection is behind, per metric, against the newest day each
  # comparison table actually measured.
  def self.stale?
    return true if none?
    ParityMetric.all.any? do |metric|
      measured = newest_measured_day(metric.model)
      next false if measured.nil?
      projected = where(metric: metric.key).maximum(:day)
      projected.nil? || measured > projected.iso8601
    end
  end

  def self.newest_measured_day(model)
    model.joins("INNER JOIN pull_requests p ON p.merge_commit_sha = #{model.table_name}.merge_commit_sha")
         .where("p.merged_at IS NOT NULL AND p.merged_at != ''")
         .pick(Arel.sql("MAX(substr(p.merged_at, 1, 10))"))
  end

  # Refresh if stale and nobody else is. The lock and the refresh share one
  # connection, as Rails' `with_advisory_lock` does.
  def self.refresh_if_stale
    return { ran: false, why: "no-stats-database" } unless Stats.configured?
    return { ran: false, why: "fresh" } unless stale?
    connection_pool.with_connection do |conn|
      return { ran: false, why: "locked" } unless conn.get_advisory_lock(REFRESH_LOCK)
      begin
        { ran: true, rows: refresh_from_stats[:rows] }
      ensure
        unless conn.release_advisory_lock(REFRESH_LOCK)
          Rails.logger.warn("parity refresh: advisory lock #{REFRESH_LOCK} was not held by this connection on release")
        end
      end
    end
  end
end
