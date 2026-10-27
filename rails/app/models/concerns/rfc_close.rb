# Auto-close an RFC when its last story lands. Story's `after_save` calls
# this, so every path that lands a story gets it.
module RfcClose
  # The CI-failures RFC is a permanent home for fixer stories and must stay
  # active. Kept in lockstep with scripts/auto-close.mjs and btwhooks.
  NEVER_AUTO_CLOSE = %w[0061-ci-failures].freeze

  TERMINAL = %w[done closed].freeze

  module_function

  # Close `rfc_id` if it is active and every one of its stories is terminal.
  # An RFC with NO stories is left alone. Answers whether it closed anything.
  def close_if_complete(rfc_id)
    return false if rfc_id.blank? || NEVER_AUTO_CLOSE.include?(rfc_id)
    rfc = Rfc.find_by(id: rfc_id)
    return false unless rfc&.active?

    total = rfc.stories.count
    return false if total.zero?
    return false if rfc.stories.where.not(status: TERMINAL).exists?

    rfc.update!(status: "closed", updated_on: Time.now.utc.to_date.iso8601)
    Event.create!(at: Story.now_iso, verb: "rfc-close", rfc_id: rfc_id, actor: "auto",
                  detail: { reason: "all stories done or closed", stories: total }.to_json)
    Rails.logger.info("closed rfc #{rfc_id} — all #{total} stories are done or closed")
    true
  end
end
