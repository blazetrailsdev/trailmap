# One refine report: an RFC-refine agent's summary of a pass over an RFC's
# stories (kind=rfc-refine). On Base, with the summary in Active Storage
# (RFC 0243, Decision 1). `stories` is the RFC's story count when the report
# landed; nil for a report that never recorded one.
#
# The trails app's `Refinement`: Ruby's core `Refinement` class holds that
# constant (rails/DEVIATIONS.md). `polymorphic_name` keeps the attachments'
# `record_type` the same, so either app reads the other's summaries.
class RfcRefinement < ApplicationRecord
  OUTCOMES = %w[changed no-change aborted].freeze

  self.table_name = "refinements"

  def self.polymorphic_name = "Refinement"

  has_one_attached :summary

  validates :rfc_id, presence: true
  validates :outcome, inclusion: { in: OUTCOMES }

  scope :for_rfc, ->(rfc_id) { where(rfc_id: rfc_id).order(created_at: :desc, id: :desc) }
end
