import type { MessageDelivery } from "@blazetrails/actionmailer";
import { ApplicationMailer } from "./application-mailer.ts";

/** What a failed `StatsSyncJob` run reports, as cron-wrapper.sh's mail did. */
export interface StatsSyncFailure {
  to: string;
  stage: string;
  execution: number;
  error: string;
  log: string;
}

/** The alert cron-wrapper.sh sent through msmtp when the daily sync failed. */
export class StatsSyncMailer extends ApplicationMailer {
  // The class-level action call Base's methodMissing answers; untyped until
  // actionmailer-smtp-settings-typed-and-railtie.
  declare static failed: (failure: StatsSyncFailure) => MessageDelivery;

  failed(failure: StatsSyncFailure): ReturnType<ApplicationMailer["mail"]> {
    return this.mail({
      to: failure.to,
      from: failure.to,
      subject: `[stats-sync] failed at "${failure.stage}" (execution ${failure.execution})`,
      body: `StatsSyncJob gave up after its retries.\n\nStage: ${failure.stage}\nError: ${failure.error}\n\nLast 30 lines:\n${failure.log}\n`,
    });
  }
}
