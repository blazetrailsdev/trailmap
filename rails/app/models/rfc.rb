class Rfc < ApplicationRecord
  # Only `/search` reads it, in SQL; a loaded row should not carry 3 KB of markdown.
  self.ignored_columns = %w[body]

  STATUSES = %w[draft active closed postponed superseded].freeze

  has_many :stories

  serialize :packages, coder: JsonArray
  serialize :clusters, coder: JsonArray
  serialize :related_rfcs, coder: JsonArray

  enum :status, STATUSES.index_by(&:itself)

  # A closed RFC may not hold an unfinished story. Runs in the `ingest`
  # context only; the auto-close rule (RfcClose) maintains it on the mutation
  # path.
  validate on: :ingest do
    SemanticValidation.closed_rfc_errors(self, stories.to_a).each { |m| errors.add(:base, m) }
  end

  # `created_on`/`updated_on` are markdown's date-only `created:`/`updated:`
  # fields. Rails' update timestamps are `updated_at` AND `updated_on`, so the
  # touch must be held to the real row timestamp. The create touch fills any
  # nil timestamp column, so an RFC without `created:` would get an instant.
  def self.timestamp_attributes_for_create
    [ "created_at" ]
  end
  private_class_method :timestamp_attributes_for_create

  def self.timestamp_attributes_for_update
    [ "updated_at" ]
  end
  private_class_method :timestamp_attributes_for_update

  # `tasks rfc-priority <rfc> <n|clear>` (tasks/src/verbs.ts `setRfcPriority`):
  # the priority every story without its own inherits in the ready queue.
  # DB-owned, so a row write and an `rfc-priority` event; `update_all`, as the
  # CLI's, touches no timestamp.
  def priority_set(new_priority)
    unless new_priority.nil? || (new_priority.is_a?(Integer) && new_priority >= 0)
      raise VerbExit.new(1, %(priority must be a non-negative integer or "clear"))
    end
    label = new_priority.nil? ? "(clear)" : new_priority.to_s
    transaction do
      Rfc.where(id: id).update_all(priority: new_priority)
      Event.create!(at: Story.now_iso, verb: "rfc-priority", rfc_id: id, detail: { arg: label }.to_json)
    end
    self.priority = new_priority
    clear_attribute_change(:priority)
    "rfc-priority #{label}: #{id}"
  end
end
