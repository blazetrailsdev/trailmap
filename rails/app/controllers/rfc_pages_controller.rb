# `/rfcs` and `/rfc/<id>` — the RFC list and show page, ports of ringo's
# `/rfcs` script and `HandleRFCPage`. Tabs are links, not a client filter.
class RfcPagesController < ApplicationController
  # ringo's STATUS_ORDER; active is the default view.
  STATUS_TABS = %w[active draft postponed closed superseded].freeze

  Tab = Struct.new(:key, :label, :count, :href, :active, keyword_init: true)
  Tick = Struct.new(:kind, :pct, :title, keyword_init: true)
  Row = Struct.new(:id, :title, :owner, :priority, :superseded_by, :clusters, :counts, :bar, :bar_length,
                   :stalled, :ticks, :story_total, :open_days, keyword_init: true)
  StoryRow = Struct.new(:id, :title, :status, :est_loc, :cluster, :priority, keyword_init: true)

  def index
    rfcs = Rfc.all.to_a
    by_rfc = Hash.new { |h, k| h[k] = [] }
    story_rfc = {}
    Story.pluck(:rfc_id, :status, :id).each do |rfc_id, status, id|
      story_rfc[id] = rfc_id
      by_rfc[rfc_id] << status
    end
    events = Event.where(verb: %w[new spawn]).order(:at, :id).pluck(:at, :verb, :story_id, :rfc_id, :detail).map do |at, verb, story_id, rfc_id, detail|
      RfcMarks::MarkEvent.new(at: at.to_s, verb: verb, story_id: story_id, rfc_id: rfc_id, detail: detail)
    end

    tab_counts = rfcs.map(&:status).tally
    open_count = rfcs.to_h { |r| [ r.id, RfcProgress.story_counts(by_rfc.fetch(r.id, [])).open ] }
    # Over every RFC, not the tab's: the scale must not move with the tab.
    bar_scale = RfcProgress.bar_scale(rfcs.map { |r| by_rfc.fetch(r.id, []).size })
    marks = RfcMarks.collect(rfcs.to_set(&:id), story_rfc, events)

    @filter = STATUS_TABS.include?(params[:status]) ? params[:status] : "active"
    @total = rfcs.size
    @tabs = STATUS_TABS.map do |s|
      Tab.new(key: s, label: s, count: tab_counts.fetch(s, 0), href: "/rfcs?status=#{s}", active: s == @filter)
    end
    shown = RfcProgress.order_rfcs_for_index(rfcs.select { |r| r.status == @filter }, open_count)
    @rows = shown.map do |rfc|
      own = by_rfc.fetch(rfc.id, [])
      bar_length = RfcProgress.bar_length(own.size, bar_scale)
      ticks = marks.fetch(rfc.id, []).select { |m| m.count.positive? }.map do |m|
        Tick.new(kind: m.kind, pct: RfcProgress.bar_length(m.count, bar_scale).pct, title: RfcMarks.title(m))
      end
      Row.new(id: rfc.id, title: rfc.title || rfc.id, owner: rfc.owner, priority: rfc.priority,
              superseded_by: rfc.superseded_by, clusters: rfc.clusters, counts: RfcProgress.story_counts(own),
              bar: RfcProgress.status_counts(own, rfc.status), bar_length: bar_length,
              stalled: RfcProgress.stalled?(rfc.status, own),
              # A tick at the bar's own end says nothing and smears the tip.
              ticks: ticks.select { |t| (t.pct - bar_length.pct).abs >= 0.5 },
              story_total: own.size,
              open_days: RfcProgress.terminal?(rfc.status) ? nil : Elapsed.days_since(rfc.created_on))
    end
  end

  # A missing RFC renders the page with a 404, naming the id.
  def show
    @id = params[:id].to_s
    @rfc = @id.empty? ? nil : Rfc.find_by(id: @id)
    @body = nil
    @error = ""
    return render status: :not_found if @rfc.nil?

    stories = RfcProgress.order_stories_for_rfc(Story.where(rfc_id: @id).to_a, @rfc.status)
    @stories = stories.map do |s|
      StoryRow.new(id: s.id, title: s.title || s.id, status: EffectiveStatus.of(@rfc.status, s.status).to_s,
                   est_loc: s.est_loc, cluster: s.cluster, priority: s.priority)
    end
    @counts = RfcProgress.story_counts(stories.map(&:status))
    doc = Document.read(@rfc.file_path)
    @body = doc.markdown.empty? ? nil : helpers.render_markdown(doc.markdown)
    @error = doc.error
  end
end
