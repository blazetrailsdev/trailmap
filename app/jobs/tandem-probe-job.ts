import { ApplicationJob } from "./application-job.ts";

/**
 * The job both apps can run, whichever enqueued it: the shared-artefact proof in
 * CLAUDE.md. test/jobs and rails/test/jobs each run the payload the other app
 * serialized. StatsSyncJob cannot be that job: the sync is TypeScript only.
 */
export class TandemProbeJob extends ApplicationJob {
  static performed: string[] = [];

  async perform(message: string): Promise<void> {
    TandemProbeJob.performed.push(message);
  }
}
