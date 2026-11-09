import type { MessageDelivery } from "@blazetrails/actionmailer";
import { ApplicationMailer } from "./application-mailer.ts";

/** What `ApplicationJob#mailFailure` reports about a job that failed for good. */
export interface JobFailure {
  to: string;
  jobClass: string;
  jobId: string | null;
  arguments: string;
  executions: number;
  exceptionClass: string;
  message: string;
  backtrace: string;
  details: string[];
}

/** Mail to whoever runs trailmap: failed jobs, and the probe `/mail-test` sends. */
export class OpsMailer extends ApplicationMailer {
  // The class-level action calls Base's methodMissing answers; untyped until
  // actionmailer-smtp-settings-typed-and-railtie.
  declare static jobFailed: (failure: JobFailure) => MessageDelivery;
  declare static probe: (probe: { to: string; from: string }) => MessageDelivery;

  jobFailed(failure: JobFailure): ReturnType<ApplicationMailer["mail"]> {
    const lines = [
      `${failure.jobClass} failed for good and was discarded.`,
      "",
      `Job:        ${failure.jobClass}`,
      `Job id:     ${failure.jobId ?? "(none)"}`,
      `Arguments:  ${failure.arguments}`,
      `Executions: ${failure.executions}`,
      `Exception:  ${failure.exceptionClass}: ${failure.message}`,
    ];
    if (failure.details.length > 0) lines.push("", ...failure.details);
    lines.push("", "Backtrace:", failure.backtrace);
    return this.mail({
      to: failure.to,
      from: failure.to,
      subject: `[trailmap] ${failure.jobClass} failed: ${failure.exceptionClass}: ${failure.message.split("\n")[0]}`,
      body: `${lines.join("\n")}\n`,
    });
  }

  probe(probe: { to: string; from: string }): ReturnType<ApplicationMailer["mail"]> {
    return this.mail({
      to: probe.to,
      from: probe.from,
      subject: "[trailmap] test email",
      body: `This is a test email from trailmap's /mail-test page, sent at ${new Date().toISOString()}.\n`,
    });
  }
}
