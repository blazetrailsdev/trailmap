import { ApplicationJob } from "./application-job.ts";

export class DeliberateFailure extends Error {
  override name = "DeliberateFailure";
}

/**
 * The job `/mail-test` enqueues to prove a failed job's mail end to end: it
 * raises every time, nothing retries it, so it is discarded on its first run.
 */
export class FailingProbeJob extends ApplicationJob {
  async perform(note: string): Promise<void> {
    throw new DeliberateFailure(`deliberate failure from /mail-test: ${note}`);
  }
}
