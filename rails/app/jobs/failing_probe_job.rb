# The job `/mail-test` enqueues to prove a failed job's mail end to end: it
# raises every time, nothing retries it, so it is discarded on its first run.
class FailingProbeJob < ApplicationJob
  def perform(note)
    raise DeliberateFailure, "deliberate failure from /mail-test: #{note}"
  end
end
