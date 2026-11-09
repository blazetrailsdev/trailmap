import { Base } from "@blazetrails/activejob";
import { env, rbInspect } from "@blazetrails/ruby-compat";
import { OpsMailer } from "../mailers/ops-mailer.ts";

/**
 * Every trailmap job's base class, as `trails new` would generate it (Rails'
 * app/jobs/application_job.rb). A job is found by its class NAME twice: the
 * recurring scheduler resolves `class:` from config/recurring.yml, and the
 * worker resolves the payload's `job_class`. Rails autoloads both, and so does
 * the trails autoloader.
 *
 * A job that fails for good mails `EMAIL`. `after_discard` is the one hook
 * Active Job runs for both ways that happens: `retry_on` running out of
 * attempts, and an exception nothing rescued (`Execution#perform_now`). A
 * failure that will be retried does not reach it, so each failed job is
 * mailed once.
 */
export class ApplicationJob extends Base {
  static {
    this.afterDiscard(async (job, exception) => (job as ApplicationJob).mailFailure(exception));
  }

  /**
   * Never raises: Active Job re-raises the first error an `after_discard`
   * block raises in place of the job's own, and the job's is the one to keep.
   */
  async mailFailure(exception: unknown): Promise<void> {
    const to = env.EMAIL;
    if (!to) {
      this.failureMailNotSent("no alert email sent: EMAIL is not set");
      return;
    }
    try {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      await OpsMailer.jobFailed({
        to,
        jobClass: this.constructor.name,
        jobId: this.jobId,
        arguments: rbInspect(this.arguments),
        executions: this.executions ?? 1,
        exceptionClass: error.constructor.name,
        message: error.message,
        backtrace: error.stack ?? "",
        details: await this.failureDetails(),
      }).deliverNow();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      this.failureMailNotSent(`alert email to ${to} could not be sent: ${cause}`);
    }
  }

  /** What a job adds to its failure mail beyond the exception: a stage, a log tail. */
  protected async failureDetails(): Promise<string[]> {
    return [];
  }

  /** Where a job notes that its failure went unmailed. */
  protected failureMailNotSent(reason: string): void {
    (ApplicationJob.logger as { error?(m: string): void } | null)?.error?.(`[${this.constructor.name}] ${reason}`);
  }
}
