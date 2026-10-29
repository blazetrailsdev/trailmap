class Rfc < ApplicationRecord
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
end
