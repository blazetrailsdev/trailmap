# `/packages` — every trails package, grouped by whether it ports a Rails
# counterpart (RFC 0222). The list is the latest `package_meta` commit's, so a
# package no comparison measures is still listed and says "no data".
class PackagesController < ApplicationController
  Row = Struct.new(:name, :rails_counterpart, :api, :tests, :open_stories, keyword_init: true)

  def index
    @configured = Stats.configured?
    rows = []
    by_package, @unattributed = Story.open_counts_by_package
    if @configured
      latest = PackageMeta.order(pr_number: :desc).first
      metas = latest ? PackageMeta.where(merge_commit_sha: latest.merge_commit_sha).order(:package) : []
      api = latest_percents(ApiCompareStat)
      tests = latest_percents(TestCompareStat)
      rows = metas.map do |meta|
        Row.new(name: meta.package, rails_counterpart: meta.rails_counterpart,
                api: api[meta.package], tests: tests[meta.package],
                open_stories: by_package[meta.package])
      end
    end
    @counterparts, @trails_only = rows.partition(&:rails_counterpart)
  end

  private
    # Each package's percent on the latest merge commit that measured it.
    def latest_percents(model)
      table = model.table_name
      model.where("(package, pr_number) IN (SELECT package, MAX(pr_number) FROM #{table} GROUP BY package)")
           .to_h { |row| [ row.package, row.percent ] }
    end
end
