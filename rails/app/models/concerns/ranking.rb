# Ready-queue ranking and bundle packing, ported from the CLI's
# src/ranking.ts by way of ../../../app/models/concerns/ranking.ts.
#
# Pure functions over a loaded snapshot (`Index`); `Story`'s class methods do
# the loading and delegate here. The queue is `claimable`, never `ready` — the
# enum already generates `Story.ready` meaning only `status = 'ready'`.
module Ranking
  # A snapshot of everything the queue reads, loaded once per query.
  Index = Struct.new(:stories, :rfc_status, :rfc_priority, :deps, :rfc_deps, :paths, :packages,
                     keyword_init: true)

  PriorityContext = Struct.new(:rfc_priority, :remaining)

  # What the CLI's index sorts an unprioritized story as. Ties break on id.
  PRIORITY_UNSET = 1_000_000

  # "Someone still intends to do this". Drafts count.
  OPEN_STORY_STATUSES = %w[draft ready claimed in-progress blocked].freeze

  module_function

  # A dep is satisfied when `done` OR `closed`.
  def dep_resolved?(status)
    status == "done" || status == "closed"
  end

  def effective_priority(story, rfc_priority)
    story.priority || rfc_priority[story.rfc_id] || Float::INFINITY
  end

  def priority_context(index)
    remaining = Hash.new(0)
    index.stories.each { |s| remaining[s.rfc_id] += 1 unless dep_resolved?(s.status) }
    PriorityContext.new(index.rfc_priority, remaining)
  end

  def compare_priority(a, b, ctx)
    ea = effective_priority(a, ctx.rfc_priority)
    eb = effective_priority(b, ctx.rfc_priority)
    return ea < eb ? -1 : 1 if ea != eb
    pa = ctx.rfc_priority[a.rfc_id]
    pb = ctx.rfc_priority[b.rfc_id]
    return 0 if pa.nil? || pa != pb
    ctx.remaining[a.rfc_id] <=> ctx.remaining[b.rfc_id]
  end

  # Whether a story waits on a dep: a story dep not resolved, or an RFC dep
  # not closed. The queue's dep gate, and `EffectiveStatus.shown`'s `dep_held`.
  def dep_held?(id, deps, rfc_deps, story_status, rfc_status)
    deps.fetch(id, []).any? { |d| !dep_resolved?(story_status[d]) } ||
      rfc_deps.fetch(id, []).any? { |d| rfc_status[d] != "closed" }
  end

  # `dep_held?` over a whole snapshot: the ids of every story waiting on a dep.
  def dep_held_in(index)
    story_status = index.stories.to_h { |s| [ s.id, s.status ] }
    index.stories.filter_map { |s| s.id if dep_held?(s.id, index.deps, index.rfc_deps, story_status, index.rfc_status) }.to_set
  end

  def claimable_in(index, rfc: nil)
    ctx = priority_context(index)
    story_status = index.stories.to_h { |s| [ s.id, s.status ] }
    picked = index.stories.select do |s|
      next false unless EffectiveStatus.of(index.rfc_status[s.rfc_id], s.status) == "ready"
      next false if rfc.present? && s.rfc_id != rfc
      !dep_held?(s.id, index.deps, index.rfc_deps, story_status, index.rfc_status)
    end
    StableSort.sort(picked) { |a, b| compare_priority(a, b, ctx) }
  end

  # 0/1 knapsack: max total est_loc within budget.
  def best_bundle(items, budget)
    n = items.size
    return [] if n.zero? || budget <= 0
    dp = Array.new(n + 1) { Array.new(budget + 1, 0) }
    (1..n).each do |i|
      cost = items[i - 1].est_loc || 0
      (0..budget).each do |b|
        dp[i][b] = dp[i - 1][b]
        dp[i][b] = [ dp[i][b], dp[i - 1][b - cost] + cost ].max if cost.positive? && cost <= b
      end
    end
    chosen = []
    b = budget
    n.downto(1) do |i|
      next if dp[i][b] == dp[i - 1][b]
      chosen << items[i - 1]
      b -= items[i - 1].est_loc || 0
    end
    chosen.reverse
  end

  def bundle_scope(index, cluster: nil, rfc: nil)
    claimable_in(index, rfc: rfc).select { |s| cluster.present? ? s.cluster == cluster : true }
  end

  def empty_bundle_reason_in(index, cluster: nil, rfc: nil)
    bundle_scope(index, cluster: cluster, rfc: rfc).empty? ? "no-matching-stories" : "none-within-budget"
  end

  def next_bundle_in(index, max_loc:, cluster: nil, rfc: nil)
    in_scope = bundle_scope(index, cluster: cluster, rfc: rfc)
    ctx = priority_context(index)
    prioritized = in_scope.select { |s| effective_priority(s, ctx.rfc_priority) != Float::INFINITY }
    if prioritized.any?
      lead = prioritized.first
      rest = in_scope.select { |s| s.id != lead.id && s.cluster == lead.cluster && !s.est_loc.nil? }
      fill = StableSort.sort(best_bundle(rest, max_loc - (lead.est_loc || 0))) { |a, b| compare_priority(a, b, ctx) }
      return [ lead, *fill ]
    end
    by_cluster = in_scope.reject { |s| s.est_loc.nil? }.group_by(&:cluster)
    best = []
    best_total = 0
    by_cluster.each_value do |group|
      subset = best_bundle(group, max_loc)
      total = subset.sum { |s| s.est_loc || 0 }
      if total > best_total
        best = subset
        best_total = total
      end
    end
    best
  end

  def summarize_bundle(rows, max_loc)
    total = rows.sum { |s| s.est_loc || 0 }
    { total: total, lead_exceeds_budget: total > max_loc }
  end

  def list_filtered_in(index, rfc: nil, status: nil, cluster: nil)
    index.stories.select do |s|
      next false if rfc.present? && s.rfc_id != rfc
      next false if status.present? && EffectiveStatus.of(index.rfc_status[s.rfc_id], s.status) != status
      next false if cluster.present? && s.cluster != cluster
      true
    end
  end

  # Matched in tiers — exact, then directory-prefix, then substring. Only the
  # first tier that matches is returned.
  def stories_touching_in(index, query, all: false)
    q = query.delete_prefix("./")
    dir = q.end_with?("/") ? q : "#{q}/"
    scoped = index.stories.select do |s|
      all || OPEN_STORY_STATUSES.include?(EffectiveStatus.of(index.rfc_status[s.rfc_id], s.status))
    end
    tier = ->(match) { scoped.select { |s| index.paths.fetch(s.id, []).any?(&match) } }
    exact = tier.call(->(p) { p == q })
    return exact if exact.any?
    prefixed = tier.call(->(p) { p.start_with?(dir) })
    return prefixed if prefixed.any?
    tier.call(->(p) { p.include?(q) })
  end
end
