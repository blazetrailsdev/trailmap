# Which stories the backlog list shows under each tab, and in what order.
# Ported from ringo's backlog page (webhook/backlog.go); the ready-queue ORDER
# is `Story.claimable`, not re-derived here.
module Backlog
  # RFC states that put every story under them on ice (ICEBOX_RFC_STATUS).
  ICEBOX_RFC_STATUSES = %w[draft postponed].freeze

  FILTERS = %w[open done ready draft blocked icebox].freeze

  # ringo's STATUS_ORDER: actionable first, done last.
  STATUS_ORDER = %w[in-progress claimed ready blocked draft done].freeze

  # What the list needs of a story; `status` is the EFFECTIVE one.
  Row = Struct.new(:id, :rfc_id, :status, keyword_init: true)

  module_function

  def filter?(value)
    FILTERS.include?(value)
  end

  # Iced is judged by the PARENT RFC's status, never the story's own.
  def iceboxed?(story, rfc_status)
    ICEBOX_RFC_STATUSES.include?(rfc_status[story.rfc_id].to_s)
  end

  # One tab's predicate, ringo's `matchesFilter`.
  def matches?(story, filter, rfc_status)
    iced = iceboxed?(story, rfc_status)
    case filter
    when "icebox" then iced && story.status != "done"
    when "open" then story.status != "done" && !iced
    when "done" then story.status == "done"
    when "draft" then story.status == "draft" && !iced
    else story.status == filter
    end
  end

  # Status group first, then the ready queue in pick order, then id.
  def order(stories, queue_pos)
    rank = ->(s) { STATUS_ORDER.index(s.status) || 99 }
    StableSort.sort(stories) do |a, b|
      by_status = rank.call(a) <=> rank.call(b)
      next by_status unless by_status.zero?
      pa = queue_pos[a.id]
      pb = queue_pos[b.id]
      if pa && pb then pa <=> pb
      elsif pa then -1
      elsif pb then 1
      else LocaleCompare.compare(a.id, b.id)
      end
    end
  end
end
