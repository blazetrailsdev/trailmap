# `/graphs/parity` — how the trails port is converging, per package. The data
# is trailmap's (the `parity_days` projection); the DRAWING is ringo's own,
# vendored. `data` answers ringo's JSON, field for field, errors included
# (`{ error }` with a 200, as ringo's `fail` closure).
class ParityGraphsController < ApplicationController
  MAX_PACKAGES = 8

  Offered = Struct.new(:key, :label, :gaps, keyword_init: true)

  def show
    @charted = ParityDay.exists?
    @can_refresh = Stats.configured?
  end

  def data
    selected = []
    (csv(:metrics) + csv(:metric)).each do |key|
      metric = ParityMetric.lookup(key) or return render json: { error: "unknown metric #{key}" }
      selected << metric unless selected.any? { |m| m.key == metric.key }
    end
    requested = csv(:packages)
    return render json: { error: "at most #{MAX_PACKAGES} packages at a time" } if requested.size > MAX_PACKAGES

    # A refresh is an optimisation on data the page already has.
    begin
      ParityDay.refresh_if_stale
    rescue StandardError => e
      logger.warn("parity refresh failed; serving the existing projection: #{e.message}")
    end

    charted = ParityDay.distinct.pluck(:metric).to_set
    available = ParityMetric.all.select { |m| charted.include?(m.key) }
    gaps_by_metric = available.to_h { |m| [ m.key, stored_gaps_for(m) ] }
    offered = available.map { |m| { key: m.key, label: m.label, gaps: gaps_by_metric[m.key] } }
    selected << available.first if selected.empty? && available.any?
    chartable = selected.select { |m| available.any? { |a| a.key == m.key } }

    if available.empty?
      return render json: {
        error: if Stats.configured?
                 "The parity projection is empty. Run `pnpm parity:sync` to fill it."
               else
                 "The parity projection is empty and STATS_DB is not set, so nothing here can fill it."
               end
      }
    end

    per_metric = chartable.to_h { |m| [ m.key, ParityDay.where(metric: m.key).distinct.pluck(:package).select(&:present?).to_set ] }
    packages = per_metric.values.reduce(Set.new, :|).to_a.sort
    kept = requested.select { |p| chartable.any? { |m| per_metric[m.key].include?(p) } }
    since = since_for(params[:days])

    series = chartable.flat_map do |m|
      want = kept.select { |p| per_metric[m.key].include?(p) }
      next [] if want.empty?
      # `load_async` is the Rails shape for eight independent reads; the
      # trails app reads them in sequence until its vendored pin moves.
      ParityJson.series(ParityDay.for_chart(m.key, want, since).to_a, m.key, want)
    end

    render json: {
      metrics_selected: selected.map(&:key), gaps_by_metric: gaps_by_metric, metrics: offered,
      packages: packages, unknown_packages: requested - kept, max_packages: MAX_PACKAGES, series: series
    }
  end

  private

  def csv(name)
    params[name].to_s.split(",").map(&:strip).reject(&:empty?)
  end

  # `?days=abc`, `0` and `-5` are no bound, as ringo's `paritySince`.
  def since_for(days)
    return nil if days.blank? || days == "all"
    n = Integer(days, 10, exception: false)
    return nil if n.nil? || n <= 0
    (Time.now.utc - n.days).to_date.iso8601
  end

  # The gap counters the projection stored, in the metric's order.
  def stored_gaps_for(metric)
    return nil if metric.gaps.blank?
    stored = ParityDay.where(metric: metric.key).where.not(gaps: nil).first&.gaps
    return nil if stored.nil?
    metric.gaps.select { |g| stored.key?(g) }.presence
  end
end
