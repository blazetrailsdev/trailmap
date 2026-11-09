import { env } from "@blazetrails/ruby-compat";
import { ApplicationController } from "./application-controller.ts";
import { FailingProbeJob } from "../jobs/failing-probe-job.ts";
import { OpsMailer } from "../mailers/ops-mailer.ts";

/** What the page reports about the last thing it was asked to do. */
export interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * `/mail-test` — prove the mail path works without waiting for a job to fail.
 *
 * One form sends a test email to any address, synchronously, so the page can
 * say whether the SMTP relay took it. One button enqueues `FailingProbeJob`,
 * which the worker runs, fails and discards, so `ApplicationJob`'s failure
 * mail goes to `EMAIL` the way a real failure's would. It sits behind the same
 * door as `/dashboard`: Authelia in front of nginx, and loopback on the box.
 */
export class MailTestsController extends ApplicationController {
  async show(): Promise<void> {
    await this._renderPage(null, 200);
  }

  /** `POST /mail-test`: deliver the test email now and report what the relay said. */
  async deliver(): Promise<void> {
    const to = String(this.params.get("to") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+$/.test(to)) {
      await this._renderPage({ ok: false, message: "Give an email address to send to." }, 422);
      return;
    }
    try {
      await OpsMailer.probe({ to, from: env.EMAIL || to }).deliverNow();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      await this._renderPage({ ok: false, message: `The test email to ${to} could not be sent: ${cause}` }, 502);
      return;
    }
    await this._renderPage({ ok: true, message: `Sent a test email to ${to}.` }, 200);
  }

  /** `POST /mail-test/failing-job`: enqueue a job that fails, to exercise the failure mail. */
  async enqueue(): Promise<void> {
    let job;
    try {
      job = await FailingProbeJob.performLater(`enqueued ${new Date().toISOString()}`);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      await this._renderPage({ ok: false, message: `FailingProbeJob could not be enqueued: ${cause}` }, 502);
      return;
    }
    const id = job ? (job as { jobId?: string | null }).jobId : null;
    const message = env.EMAIL
      ? `Enqueued FailingProbeJob ${id ?? ""}. When the worker runs it, its failure is mailed to ${env.EMAIL}.`
      : `Enqueued FailingProbeJob ${id ?? ""}, but EMAIL is not set, so its failure will not be mailed.`;
    await this._renderPage({ ok: env.EMAIL != null && env.EMAIL !== "", message }, 200);
  }

  private async _renderPage(outcome: Outcome | null, status: number): Promise<void> {
    await this.render({
      action: "show",
      status,
      locals: {
        outcome,
        alertTo: env.EMAIL || null,
        smtpAddress: env.SMTP_ADDRESS ?? "localhost",
        to: String(this.params.get("to") ?? env.EMAIL ?? ""),
      },
    });
  }
}
