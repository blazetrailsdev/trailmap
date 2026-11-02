# The job both apps can run, whichever enqueued it: the shared-artefact proof in
# ../../CLAUDE.md. rails/test/jobs and test/jobs each run the payload the other
# app serialized. StatsSyncJob cannot be that job: the sync is TypeScript only.
class TandemProbeJob < ApplicationJob
  cattr_accessor :performed, default: []

  def perform(message)
    performed << message
  end
end
