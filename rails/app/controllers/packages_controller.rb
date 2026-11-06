# `/packages` — every trails package, grouped by whether it ports a Rails
# counterpart (RFC 0222). The list is the latest `package_meta` commit's, so a
# package no comparison measures is still listed and says "no data".
class PackagesController < ApplicationController
  Row = Struct.new(:name, :rails_counterpart, :api, :tests, :open_stories, keyword_init: true)
  MarkRow = Struct.new(:mark, :latest, :points, keyword_init: true)
  FileRow = Struct.new(:rails_file, :ts_file, :matched, :missing, :test_percent, :stories, keyword_init: true)

  TRAILS_BLOB = "https://github.com/blazetrailsdev/trails/blob"
  # The retired catch-all bucket, attributed per story by Story.touching_package.
  CATCH_ALL_BUCKET = "0023-surfaced-deviations"

  def index
    @configured = Stats.configured?
    rows = []
    by_package, @unattributed = Story.open_counts_by_package
    if @configured
      latest = PackageMeta.order(pr_number: :desc).first
      metas = latest ? PackageMeta.where(merge_commit_sha: latest.merge_commit_sha).order(:package) : []
      api = latest_ratios(ApiCompareStat)
      tests = latest_ratios(TestCompareStat)
      rows = metas.map do |meta|
        Row.new(name: meta.package, rails_counterpart: meta.rails_counterpart,
                api: api[meta.package], tests: tests[meta.package],
                open_stories: by_package[meta.package])
      end
    end
    @counterparts, @trails_only = rows.partition(&:rails_counterpart)
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
      MarkRow.new(mark: mark, latest: last.value.nil? ? "#{last.matched} / #{last.total}" : last.value.to_s,
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
    stats = PackageFileStat.where(merge_commit_sha: latest_meta(@name).merge_commit_sha, package: @name).order(:rails_file).to_a
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
    # The latest `package_meta` row naming `name`, or a 404.
    def latest_meta(name)
      meta = PackageMeta.where(package: name).order(pr_number: :desc).first if Stats.configured?
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
    def latest_ratios(model)
      table = model.table_name
      model.where("(package, pr_number) IN (SELECT package, MAX(pr_number) FROM #{table} GROUP BY package)")
           .to_h { |row| [ row.package, row.slice(:matched, :total, :percent).symbolize_keys ] }
    end
end
