class Story < ApplicationRecord
  STATUSES = %w[draft ready claimed in-progress done blocked closed].freeze

  # A dep is satisfied when it is `done` OR `closed`.
  RESOLVED_DEP_STATUSES = %w[done closed].freeze

  # The columns StoryJson publishes, plucked rather than loaded.
  SERIALIZED_COLUMNS = %i[id rfc_id title status cluster priority updated_on est_loc pr
                          claim_at assignee blocked_by closed_reason file_path].freeze

  # A plucked story: what the ranking and the serializer read, and nothing
  # else. NOT a record, and its class says so.
  Row = Struct.new(*SERIALIZED_COLUMNS, keyword_init: true)

  belongs_to :rfc
  has_many :story_deps, inverse_of: :story
  has_many :deps, through: :story_deps, source: :depends_on
  has_many :story_rfc_deps
  has_many :rfc_deps, through: :story_rfc_deps, source: :rfc
  has_many :paths, class_name: "StoryPath"
  has_many :packages, class_name: "StoryPackage"
  has_many :events

  # Labels are IDENTICAL to stored values, hyphen included. NOTE: this
  # generates `Story.ready` meaning `status = 'ready'`, which is NOT the ready
  # queue — that is `Story.claimable`.
  enum :status, STATUSES.index_by(&:itself)

  # The semantic half of validation, in the `ingest` context only.
  validate on: :ingest do
    (SemanticValidation.lifecycle_errors(self) + SemanticValidation.est_loc_errors(self)).each do |message|
      errors.add(:base, message)
    end
  end

  after_save :close_rfc_if_complete

  # `updated_on` is markdown's date-only `updated:` field. Rails stamps both
  # `updated_at` and `updated_on` on save; hold the touch to the real one.
  def self.timestamp_attributes_for_update
    [ "updated_at" ]
  end
  private_class_method :timestamp_attributes_for_update

  # Only a landing can complete an RFC.
  def close_rfc_if_complete
    RfcClose.close_if_complete(rfc_id) if done? || closed?
  end

  # Every semantic error in the whole content set. A class method because the
  # dep graph cannot be judged from one row.
  def self.semantic_errors
    stories = Story.all.to_a
    rfcs = Rfc.all.to_a
    edges = StoryDep.pluck(:story_id, :depends_on_id).group_by(&:first).transform_values { |v| v.map(&:last) }
    rfc_edges = StoryRfcDep.pluck(:story_id, :rfc_id).group_by(&:first).transform_values { |v| v.map(&:last) }

    messages = []
    stories.each { |s| messages.concat(s.errors.full_messages) unless s.valid?(:ingest) }
    messages.concat(
      SemanticValidation.dep_graph_messages(
        SemanticValidation.check_dep_graph(
          story_ids: stories.to_set(&:id), rfc_ids: rfcs.to_set(&:id),
          deps_of: ->(id) { edges.fetch(id, []) }, deps_rfc_of: ->(id) { rfc_edges.fetch(id, []) },
          seeds: stories.map(&:id)
        )
      )
    )
    rfcs.each { |r| messages.concat(r.errors.full_messages) unless r.valid?(:ingest) }
    messages
  end

  # ──────────────────── ready queue ────────────────────

  class << self
    # Everything the queue reads, one pass per table, over records.
    def ranking_index
      ranking_index_over(Story.all.to_a)
    end

    # The same snapshot over plucked rows: enough to rank the queue and count
    # a page's tabs, at a fraction of the cost of building records.
    def bundle_outline
      cols = %i[id rfc_id status priority est_loc cluster]
      ranking_index_over(Story.pluck(*cols).map { |row| Row.new(**cols.zip(row).to_h) })
    end
    alias_method :ranking_outline, :bundle_outline

    # Every published column, as rows, for `/stories.json` and `/index.json`.
    def ranking_rows
      ranking_index_over(Story.pluck(*SERIALIZED_COLUMNS).map { |row| Row.new(**SERIALIZED_COLUMNS.zip(row).to_h) })
    end

    # `GET /stories/ready`: ranked over plucked columns, with records loaded
    # for the rows it answers with.
    def ready_queue(rfc: nil)
      index = bundle_outline
      [ records_for(Ranking.claimable_in(index, rfc: rfc)), index ]
    end

    # `next-bundle`, the same way.
    def bundle(max_loc:, cluster: nil, rfc: nil)
      index = bundle_outline
      chosen = Ranking.next_bundle_in(index, max_loc: max_loc, cluster: cluster, rfc: rfc)
      reason = chosen.empty? ? Ranking.empty_bundle_reason_in(index, cluster: cluster, rfc: rfc) : nil
      [ records_for(chosen), index, reason ]
    end

    # The ready queue: `ready`, under an ACTIVE RFC, every dep resolved,
    # ordered by effective priority.
    def claimable(rfc: nil, index: nil)
      Ranking.claimable_in(index || ranking_index, rfc: rfc)
    end

    def next_bundle(max_loc:, cluster: nil, rfc: nil, index: nil)
      Ranking.next_bundle_in(index || ranking_index, max_loc: max_loc, cluster: cluster, rfc: rfc)
    end

    def list_filtered(rfc: nil, status: nil, cluster: nil, index: nil)
      Ranking.list_filtered_in(index || ranking_index, rfc: rfc, status: status, cluster: cluster)
    end

    def touching(query, all: false, index: nil)
      Ranking.stories_touching_in(index || ranking_index, query, all: all)
    end

    # Which of `ids` (every story, when nil) wait on an unfinished dep, for a
    # page with no ranking index in hand: the edges, then what they point at.
    def dep_held_ids(ids = nil)
      return Set.new if ids&.empty?
      scope = ids.nil? ? {} : { story_id: ids }
      group = ->(rows) { rows.group_by(&:first).transform_values { |v| v.map(&:last) } }
      deps = group.call(StoryDep.where(scope).pluck(:story_id, :depends_on_id))
      rfc_deps = group.call(StoryRfcDep.where(scope).pluck(:story_id, :rfc_id))
      wanted = deps.values.flatten.uniq
      story_status = wanted.empty? ? {} : Story.where(id: wanted).pluck(:id, :status).to_h
      wanted_rfcs = rfc_deps.values.flatten.uniq
      rfc_status = wanted_rfcs.empty? ? {} : Rfc.where(id: wanted_rfcs).pluck(:id, :status).to_h
      (deps.keys | rfc_deps.keys).select { |id| Ranking.dep_held?(id, deps, rfc_deps, story_status, rfc_status) }.to_set
    end

    # ISO seconds, matching the `claim:` format the CLI writes.
    def now_iso
      Time.now.utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    end

    def today
      Time.now.utc.to_date.iso8601
    end

    private

    # Records for ranked rows, in their order; a row whose status moved
    # between the two reads is dropped rather than served stale.
    def records_for(rows)
      records = Story.where(id: rows.map(&:id)).index_by(&:id)
      rows.filter_map { |row| (r = records[row.id]) && r.status == row.status ? r : nil }
    end

    # The join tables are plucked, `ORDER BY rowid` because rowid IS the order
    # the frontmatter listed them in. The sort is not cosmetic: every tie
    # downstream falls back to (priority, id).
    def ranking_index_over(stories)
      rfcs = Rfc.pluck(:id, :status, :priority)
      group = ->(model, col) { model.order(:rowid).pluck(:story_id, col).group_by(&:first).transform_values { |v| v.map(&:last) } }
      stories = StableSort.sort(stories) do |a, b|
        ((a.priority || Ranking::PRIORITY_UNSET) <=> (b.priority || Ranking::PRIORITY_UNSET)).nonzero? || LocaleCompare.compare(a.id, b.id)
      end
      Ranking::Index.new(
        stories: stories,
        rfc_status: rfcs.to_h { |id, status, _| [ id, status ] },
        rfc_priority: rfcs.each_with_object({}) { |(id, _, priority), h| h[id] = priority unless priority.nil? },
        deps: group.call(StoryDep, :depends_on_id),
        rfc_deps: group.call(StoryRfcDep, :rfc_id),
        paths: group.call(StoryPath, :path),
        packages: group.call(StoryPackage, :package)
      )
    end
  end

  # ──────────────────── mutations (ported from the CLI's src/verbs.ts) ────────────────────

  # Claim, all-or-nothing across ids. Re-claiming what we already hold is
  # SUCCESS, not a conflict.
  def self.claim_all(ids, assignee)
    transaction do
      found = find_all_or_raise(ids)
      taken = found.select { |s| !s.assignee.nil? && s.assignee != assignee }
      if taken.any?
        raise VerbExit.new(2, "#{taken.map(&:id).join(', ')} #{taken.size > 1 ? 'are' : 'is'} already claimed")
      end

      at = now_iso
      found.select { |s| s.ready? && s.assignee.nil? }.each do |s|
        # The race resolution, and the one deliberate `update_all`: the
        # affected-row count IS the answer.
        affected = Story.where(id: s.id, status: "ready").update_all(status: "claimed", assignee: assignee, claim_at: at, updated_on: today)
        raise VerbExit.new(3, "lost claim race on #{s.id} — pick another story") if affected.zero?
        s.record_event("claim", actor: assignee)
      end
      ids.map { |id| "claimed #{id} as #{assignee}" }
    end
  end

  def self.release_all(ids)
    transaction do
      found = find_all_or_raise(ids)
      found.each { |s| raise VerbExit.new(2, "#{s.id} is #{s.status}, not claimed — nothing to release") unless s.claimed? }
      found.map(&:release)
    end
  end

  # `in-progress` and `done`, best-effort PER ID.
  def self.mark_tracking_all(ids, status, pr)
    transaction { find_all_or_raise(ids).map { |s| s.mark_tracking(status, pr) } }
  end

  # Append a `spawn` event; does NOT touch story state.
  def self.record_spawn(ids, source, branch: nil, pane: nil, rfc: nil)
    detail = { source: source, branch: branch, pane: pane }
    if rfc.present? && ids.empty?
      Event.create!(at: now_iso, verb: "spawn", rfc_id: rfc, actor: source, detail: detail.to_json)
      return "recorded spawn (#{source}) for rfc #{rfc}"
    end
    transaction { find_all_or_raise(ids).each { |s| s.record_event("spawn", actor: source, detail: detail) } }
    "recorded spawn (#{source}) for #{ids.size} stor#{ids.size == 1 ? 'y' : 'ies'}"
  end

  # `tasks status-set <id...> <status> [--from STATUS]`, all or nothing.
  def self.status_set_all(ids, new_status, from: nil)
    transaction do
      found = find_all_or_raise(ids)
      off = from ? found.reject { |s| s.status == from } : []
      raise VerbExit.new(1, "not #{from}, nothing changed: #{off.map { |s| "#{s.id} (#{s.status})" }.join(', ')}") if off.any?
      by_id = found.index_by(&:id)
      ids.map { |id| by_id.fetch(id).status_set(new_status) }
    end
  end

  def self.find_all_or_raise(ids)
    found = Story.where(id: ids).to_a
    missing = ids - found.map(&:id)
    raise VerbExit.new(1, "story not found: #{missing.join(', ')}") if missing.any?
    found
  end

  # Inverse of claim: claimed → ready, clearing the holder.
  def release
    update!(status: "ready", **cleared_by("ready"), updated_on: Story.today)
    record_event("release")
    "released #{id}"
  end

  # `in-progress` self-claims when unclaimed.
  def mark_tracking(new_status, new_pr)
    if status == new_status && pr == new_pr && (new_status != "in-progress" || !claim_at.nil?)
      return "#{new_status} #{id} (already, skipped)"
    end
    self_claim = new_status == "in-progress" && claim_at.nil? ? { claim_at: Story.now_iso, assignee: assignee || id } : {}
    update!(status: new_status, pr: new_pr, **cleared_by(new_status), **self_claim, updated_on: Story.today)
    record_event(new_status, pr: new_pr)
    "#{new_status} #{id}#{new_pr.nil? ? '' : " #{new_pr}"}"
  end

  def block(reason)
    update!(status: "blocked", **cleared_by("blocked"), blocked_by: reason, updated_on: Story.today)
    record_event("block", detail: { note: reason })
    "blocked #{id}"
  end

  # Close with a required reason; the same reason again is a no-op.
  def close(reason)
    raise VerbExit.new(1, "close requires a reason") if reason.to_s.strip.empty?
    return "closed #{id} (already, skipped)" if closed? && closed_reason == reason
    update!(status: "closed", **cleared_by("closed"), closed_reason: reason, updated_on: Story.today)
    record_event("close", detail: { note: reason })
    "closed #{id}"
  end

  # NOT `status=`'s neighbour by accident: a verb, named so it is never taken
  # for the attribute's writer.
  def status_set(new_status)
    update!(status: new_status, **cleared_by(new_status), updated_on: Story.today)
    record_event("status", detail: { arg: new_status })
    "status #{new_status}: #{id}"
  end

  def priority_set(new_priority)
    update!(priority: new_priority, updated_on: Story.today)
    label = new_priority.nil? ? "(clear)" : new_priority.to_s
    record_event("priority", detail: { arg: label })
    "priority #{label}: #{id}"
  end

  # Every mutation writes one of these.
  def record_event(verb, pr: nil, actor: nil, detail: nil)
    Event.create!(at: Story.now_iso, verb: verb, story_id: id, pr: pr, actor: actor,
                  detail: detail.nil? ? nil : detail.to_json)
  end

  private

  # The fields the OLD status owned that the NEW one invalidates.
  def cleared_by(new_status)
    fields = {}
    fields[:blocked_by] = nil unless new_status == "blocked"
    fields[:closed_reason] = nil unless new_status == "closed"
    if %w[ready draft].include?(new_status)
      fields.merge!(assignee: nil, claim_at: nil, pr: nil)
    end
    fields
  end
end
