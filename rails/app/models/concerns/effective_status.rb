# The parent-RFC status override — ONE definition, here.
#
# A `ready` story under a non-active (or unknown) RFC must never surface as
# claimable to any consumer. Only `ready` downgrades, and `draft` is the
# target. ../../../app/models/concerns/effective-status.ts has the long form.
module EffectiveStatus
  def self.of(rfc_status, story_status)
    return "draft" if story_status == "ready" && rfc_status != "active"
    story_status
  end
end
