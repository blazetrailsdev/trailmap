# `/backlog` and `/story/<id>` — the story list and show page, ports of
# ringo's backlog script and `HandleStoryPage`. The queue is
# `Ranking.claimable_in`, the function `pnpm gate` proves, never a second
# ranking written for this page.
class StoryPagesController < ApplicationController
  PAGE_SIZE = 100

  TAB_LABELS = { "open" => "Open", "done" => "Closed", "ready" => "Ready", "draft" => "Draft",
                 "blocked" => "Blocked", "icebox" => "Icebox" }.freeze

  Tab = Struct.new(:key, :label, :count, :href, :active, keyword_init: true)
  Row = Struct.new(:id, :title, :status, :rfc_id, :est_loc, :cluster, :assignee, :pr, :queue_pos, :priority,
                   :priority_inherited, :packages, :packages_inherited, :icebox, :stale_days, keyword_init: true)
  DepRow = Struct.new(:id, :status)

  def index
    index = Story.ranking_outline
    queue = Ranking.claimable_in(index)
    rfc_packages = Rfc.all.to_h { |r| [ r.id, r.packages ] }
    queue_pos = queue.each_with_index.to_h { |s, at| [ s.id, at ] }

    @filter = Backlog.filter?(params[:filter].to_s) ? params[:filter] : "open"

    # Stories under closed RFCs are not in play; statuses are effective.
    listed = index.stories.reject { |s| index.rfc_status[s.rfc_id] == "closed" }.map do |s|
      Backlog::Row.new(id: s.id, rfc_id: s.rfc_id, status: EffectiveStatus.of(index.rfc_status[s.rfc_id], s.status).to_s)
    end
    @tabs = Backlog::FILTERS.map do |key|
      Tab.new(key: key, label: TAB_LABELS[key], count: listed.count { |s| Backlog.matches?(s, key, index.rfc_status) },
              href: backlog_href(key), active: key == @filter)
    end
    shown = Backlog.order(listed.select { |s| Backlog.matches?(s, @filter, index.rfc_status) }, queue_pos)
    @pager = Pager.for(shown.size, PAGE_SIZE, Pager.requested_page(params[:page])) { |page| backlog_href(@filter, page) }
    on_page = shown[(@pager.from.zero? ? 0 : @pager.from - 1)...@pager.to]

    records = Story.where(id: on_page.map(&:id)).index_by(&:id)
    @queue_size = queue.size
    @show_queue_help = %w[open ready].include?(@filter)
    @rows = on_page.filter_map do |listing|
      story = records[listing.id] or next
      own = index.packages.fetch(story.id, [])
      inherited_priority = index.rfc_priority[story.rfc_id]
      Row.new(id: story.id, title: story.title || story.id, status: listing.status, rfc_id: story.rfc_id,
              est_loc: story.est_loc, cluster: story.cluster, assignee: story.assignee, pr: story.pr,
              queue_pos: queue_pos[story.id], priority: story.priority || inherited_priority,
              priority_inherited: story.priority.nil? && !inherited_priority.nil?,
              packages: own.empty? ? rfc_packages.fetch(story.rfc_id, []) : own, packages_inherited: own.empty?,
              icebox: Backlog.matches?(listing, "icebox", index.rfc_status),
              stale_days: Elapsed.days_since(story.updated_on))
    end
  end

  def show
    @id = params[:id].to_s
    @story = @id.empty? ? nil : Story.find_by(id: @id)
    @body = nil
    @error = ""
    @shown_status = ""
    return render status: :not_found if @story.nil?

    # ORDERED BY ROWID: the order the frontmatter listed them in.
    @rfc = Rfc.find_by(id: @story.rfc_id)
    dep_ids = StoryDep.where(story_id: @id).order(:rowid).pluck(:depends_on_id)
    rfc_dep_ids = StoryRfcDep.where(story_id: @id).order(:rowid).pluck(:rfc_id)
    @packages = StoryPackage.where(story_id: @id).order(:rowid).pluck(:package)
    @inherited = false
    if @packages.empty? && @rfc
      @packages = @rfc.packages
      @inherited = @packages.any?
    end
    @shown_status = EffectiveStatus.of(@rfc&.status, @story.status).to_s
    @deps = story_statuses_for(dep_ids)
    @rfc_deps = rfc_statuses_for(rfc_dep_ids)
    @graph = DepGraph.for(@id)
    doc = Document.read(@story.file_path)
    @body = doc.markdown.empty? ? nil : helpers.render_markdown(doc.markdown)
    @error = doc.error
  end

  private

  def backlog_href(filter, page = nil)
    page.nil? ? "/backlog?filter=#{filter}" : "/backlog?filter=#{filter}&page=#{page}"
  end

  # RFC statuses have no override: stored is shown.
  def rfc_statuses_for(ids)
    found = ids.empty? ? {} : Rfc.where(id: ids).pluck(:id, :status).to_h
    ids.map { |id| DepRow.new(id, found[id].to_s) }
  end

  # Story deps through the effective status: "does this still gate me?"
  def story_statuses_for(ids)
    return [] if ids.empty?
    stories = Story.where(id: ids).pluck(:id, :rfc_id, :status)
    rfc_status = Rfc.where(id: stories.map { |_, r, _| r }.uniq).pluck(:id, :status).to_h
    found = stories.to_h { |id, rfc_id, status| [ id, EffectiveStatus.of(rfc_status[rfc_id], status).to_s ] }
    ids.map { |id| DepRow.new(id, found[id].to_s) }
  end
end
