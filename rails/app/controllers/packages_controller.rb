# `/packages` — every trails package, grouped by whether it ports a Rails
# counterpart (RFC 0222). The list is the latest `package_meta` commit's, so a
# package no comparison measures is still listed and says "no data".
class PackagesController < ApplicationController
  Row = Struct.new(:name, :rails_counterpart, :api, :tests, :open_stories, keyword_init: true)
  MarkRow = Struct.new(:mark, :latest, :points, keyword_init: true)
  FileRow = Struct.new(:rails_file, :ts_file, :matched, :missing, :test_percent, :stories, keyword_init: true)

  Ratio = Struct.new(:matched, :total, :percent, keyword_init: true)
  Tile = Struct.new(:label, :latest, :points, keyword_init: true)

  # The overview's tiles, in order; `mark` gates read `package_mark_stats`.
  GATES = [
    { label: "api", model: ApiCompareStat },
    { label: "calls", model: ApiCallsStat },
    { label: "call args", model: ApiCallArgsStat },
    { label: "params", mark: "params" },
    { label: "predicates", mark: "predicates" },
    { label: "tests", model: TestCompareStat },
    { label: "assertions", model: TestCompareStat, assertions: true },
    { label: "privates", model: ApiComparePrivatesStat }
  ].freeze
  # The statuses the overview counts, and the work page's group order.
  COUNTED_STATUSES = %w[ready in-progress blocked done].freeze
  WORK_ORDER = %w[ready in-progress blocked draft].freeze

  TRAILS_BLOB = "https://github.com/blazetrailsdev/trails/blob"
  # The retired catch-all bucket, attributed per story by Story.touching_package.
  CATCH_ALL_BUCKET = "0023-surfaced-deviations"

  def index
    @configured = Stats.configured?
    rows = []
    by_package, @unattributed = Story.open_counts_by_package
    @package_data = package_data?
    if @package_data
      latest = PackageMeta.order(pr_number: :desc).first
      metas = latest ? PackageMeta.where(merge_commit_sha: latest.merge_commit_sha).order(:package) : []
      api = latest_ratios(ApiCompareStat)
      tests = latest_ratios(TestCompareStat)
      rows = metas.map do |meta|
        Row.new(name: meta.package, rails_counterpart: meta.rails_counterpart,
                api: ratio_for(api, meta.compare_keys),
                tests: ratio_for(tests, meta.compare_keys),
                open_stories: by_package[meta.package])
      end
    end
    @counterparts, @trails_only = rows.partition(&:rails_counterpart)
  end

  # `/packages/:name` — counterpart and purpose, a tile per gate, story counts
  # by status and the RFCs touching the package, and "Start here": the top
  # ready stories in queue order, the package CLAUDE.md, and the Rails file
  # with most missing methods.
  def show
    @name = params[:name].to_s
    @meta = latest_meta(@name)
    sha = @meta.merge_commit_sha
    @blob = "#{TRAILS_BLOB}/#{sha}"
    @tiles = GATES.map do |gate|
      ratios =
        if gate[:mark]
          PackageMarkStat.where(package: @name, mark: gate[:mark]).where.not(total: nil).order(:pr_number).map do |row|
            Ratio.new(matched: row.matched || 0, total: row.total, percent: row.total.positive? ? ((row.matched || 0) * 1000.0 / row.total).round / 10.0 : 0)
          end
        else
          gate[:model].where(package: @meta.compare_keys).order(:pr_number).group_by(&:pr_number).values.map do |rows|
            ratios = rows.map do |row|
              next { matched: row.matched, total: row.total, percent: row.percent } unless gate[:assertions]
              matched = row.matched - (row.assertion_count_mismatch || 0)
              { matched: matched, total: row.matched, percent: row.matched.positive? ? (matched * 1000.0 / row.matched).round / 10.0 : 0 }
            end
            Ratio.new(**sum_ratios(ratios))
          end
        end
      Tile.new(label: gate[:label], latest: ratios.last, points: ratios.empty? ? "" : sparkline(ratios.map(&:percent)))
    end
    @trails_only = @meta.rails_counterpart.nil?
    @tiles = @tiles.reject { |tile| tile.latest.nil? } if @trails_only

    stories = Story.touching_package(@name)
    statuses = effective_statuses(stories)
    @counts = COUNTED_STATUSES.map { |status| [ status, stories.count { |story| statuses[story.id] == status } ] }
    @rfcs = stories.select { |story| Ranking::OPEN_STORY_STATUSES.include?(statuses[story.id]) }.map(&:rfc_id).uniq.sort
    ids = stories.map(&:id).to_set
    @ready = Story.claimable.select { |story| ids.include?(story.id) }.first(3)
    @top_file = PackageFileStat.where(merge_commit_sha: sha, package: @name).where("methods_missing > 0")
                               .order(methods_missing: :desc, rails_file: :asc).first
  end

  # `/packages/:name/work` — the stories attributed to the package, grouped by
  # RFC, ready first, then in-progress, blocked and draft, done collapsed; and
  # a weekly count of their `done` events.
  def work
    @name = params[:name].to_s
    latest_meta(@name)
    stories = Story.touching_package(@name)
    @statuses = effective_statuses(stories)
    rank = ->(story) { WORK_ORDER.index(@statuses[story.id]) || WORK_ORDER.size }
    @groups = stories.sort_by { |story| [ rank.(story), story.id ] }.group_by(&:rfc_id).sort.to_h
                     .transform_values { |group| group.partition { |story| %w[done closed].exclude?(@statuses[story.id]) } }
    @burndown = Event.where(verb: "done", story_id: stories.map(&:id)).order(:at)
                     .group_by { |event| Time.parse(event.at).utc.to_date.beginning_of_week.iso8601 }
                     .map { |week, events| [ week, events.map(&:story_id).uniq.size ] }
    @max = [ 1, *@burndown.map(&:last) ].max
  end

  # `/packages/:name/deviations` — receipt counts drillable to their sites,
  # marks with their trend, parked tests by cited section, open
  # surfaced-deviations stories, and the cited CLAUDE.md sections.
  def deviations
    @name = params[:name].to_s
    @sha = latest_meta(@name).merge_commit_sha
    @blob = "#{TRAILS_BLOB}/#{@sha}"
    key = { merge_commit_sha: @sha, package: @name }
    @tags = PackageTagStat.where(key).order(:tag, :receipt).to_a
    sites = PackageTagSite.where(key).order(:file, :line).to_a
    @sites_by_tag = sites.group_by { |site| "#{site.tag} #{site.receipt}" }

    @marks = PackageMarkStat.where(package: @name).order(:pr_number).group_by(&:mark).sort.map do |mark, rows|
      last = rows.last
      MarkRow.new(mark: mark, latest: mark_latest(last),
                  points: sparkline(rows.map { |r| r.value || r.matched || 0 }))
    end

    @skips = PackageSkipTest.where(key).order(:file, :test_name).group_by { |test| test.cited_anchor.to_s }
    anchors = (sites.map(&:cited_anchor) + @skips.keys).compact_blank.uniq
    @sections = ClaudeMdSection.where(merge_commit_sha: @sha, anchor: anchors).order(:file, :heading).to_a

    buckets = Rfc.where("id LIKE ?", "%-surfaced-deviations").pluck(:id)
                 .select { |id| id.match?(/\A\d{4}-/) && id[5..] == "#{@name}-surfaced-deviations" }
    @surfaced = Story.where(rfc_id: buckets, status: Ranking::OPEN_STORY_STATUSES).order(:id).to_a +
      Story.touching_package(@name).select { |story| story.rfc_id == CATCH_ALL_BUCKET && Ranking::OPEN_STORY_STATUSES.include?(story.status) }
  end

  # `/packages/:name/files` — every Rails file of the package: its TS port,
  # methods matched and missing, test match, and the open stories naming the
  # TS path. `?sort=missing` or `?sort=tests` orders files before grouping.
  def files
    @name = params[:name].to_s
    meta = latest_meta(@name)
    @trails_only = meta.rails_counterpart.nil?
    stats = PackageFileStat.where(merge_commit_sha: meta.merge_commit_sha, package: @name).order(:rails_file).to_a
    paths = StoryPath.where(path: stats.filter_map(&:ts_file)).to_a
    open = Story.where(id: paths.map(&:story_id), status: Ranking::OPEN_STORY_STATUSES).pluck(:id).to_set
    stories_by_path = paths.select { |p| open.include?(p.story_id) }.group_by(&:path).transform_values { |ps| ps.map(&:story_id).sort }

    rows = stats.map do |row|
      FileRow.new(rails_file: row.rails_file, ts_file: row.ts_file, matched: row.methods_matched, missing: row.methods_missing,
                  test_percent: row.tests_total.positive? ? (row.tests_matched * 100.0 / row.tests_total).round : nil,
                  stories: stories_by_path.fetch(row.ts_file, []))
    end
    @sort = params[:sort].to_s
    rows = rows.sort_by.with_index { |r, i| [ -r.missing, i ] } if @sort == "missing"
    rows = rows.sort_by.with_index { |r, i| [ r.test_percent || 101, i ] } if @sort == "tests"
    @count = rows.size
    @groups = rows.group_by { |row| File.dirname(row.rails_file) }
  end

  private
    # Whether STATS_DB holds the package summaries. trailmap's stats-sync job
    # (STATS_SYNC_DB) writes them, so a STATS_DB the trails cron fills has the
    # compare tables and not these.
    def package_data?
      Stats.configured? && PackageMeta.table_exists?
    end

    # Each story's effective status (shared/_status_badge's rule), by id.
    def effective_statuses(stories)
      rfc_status = Rfc.where(id: stories.map(&:rfc_id).uniq).pluck(:id, :status).to_h
      stories.to_h { |s| [ s.id, EffectiveStatus.of(rfc_status[s.rfc_id], s.status) || s.status ] }
    end

    # A mark's latest value: its value, else matched of total (NULL matched as 0), else a dash.
    def mark_latest(row)
      return row.value.to_s unless row.value.nil?
      return "—" if row.total.nil?
      "#{row.matched || 0} / #{row.total}"
    end

    # The latest `package_meta` row naming `name`, or a 404.
    def latest_meta(name)
      meta = PackageMeta.where(package: name).order(pr_number: :desc).first if package_data?
      meta or raise ActiveRecord::RecordNotFound, "No package #{name}"
    end

    # An SVG polyline's `points` for `values` in an 80×16 box.
    def sparkline(values)
      min = values.min
      span = (values.max - min).nonzero? || 1
      step = values.size > 1 ? 80.0 / (values.size - 1) : 0
      values.each_with_index.map { |v, i| "#{(i * step).round},#{(16 - (v - min) * 16.0 / span).round}" }.join(" ")
    end

    # Each package's matched, total and percent on the latest merge commit that measured it.
    # One ratio for a package whose rows sit under several compare keys
    # (`actionpack`): matched and total summed, the percent recomputed. A
    # single row keeps CI's own percent.
    def sum_ratios(ratios)
      return ratios.first if ratios.size <= 1
      matched = ratios.sum { |r| r[:matched] }
      total = ratios.sum { |r| r[:total] }
      { matched: matched, total: total, percent: total.positive? ? (matched * 1000.0 / total).round / 10.0 : 0 }
    end

    # `ratios` for `keys`, summed over the keys measured on the newest of
    # their commits, so a key the latest run did not write never adds a stale
    # total.
    def ratio_for(ratios, keys)
      found = ratios.values_at(*keys).compact
      pr = found.map { |r| r[:pr] }.max
      sum_ratios(found.select { |r| r[:pr] == pr }.map { |r| r.except(:pr) })
    end

    def latest_ratios(model)
      table = model.table_name
      model.where("(package, pr_number) IN (SELECT package, MAX(pr_number) FROM #{table} GROUP BY package)")
           .to_h { |row| [ row.package, row.slice(:matched, :total, :percent).symbolize_keys.merge(pr: row.pr_number) ] }
    end
end
