# One refine report: an RFC-refine agent's summary of a pass over an RFC's
# stories (kind=rfc-refine). The RFC page's Refinements tab shows the newest
# and lists the rest. `rfc_id` is the task domain's RFC id, a string.
class RfcRefine < Hub
  OUTCOMES = %w[changed no-change aborted].freeze

  validates :rfc_id, presence: true
  validates :outcome, inclusion: { in: OUTCOMES }

  scope :for_rfc, ->(rfc_id) { where(rfc_id: rfc_id).order(created_at: :desc, id: :desc) }
end
