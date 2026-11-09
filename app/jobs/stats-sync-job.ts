import { Duration } from "@blazetrails/activesupport";
import { env, getFs, getPath } from "@blazetrails/ruby-compat";
import { isTransientGhError } from "../../lib/stats-sync/gh-transient-error.ts";
import { StatsSyncMailer } from "../mailers/stats-sync-mailer.ts";
import { ApplicationJob } from "./application-job.ts";

const STALE_HOURS = 26;

// `attempts` is total executions, as retry_on counts them: the wrapper's run plus its retries.
class RateLimitedSync extends Error {
  static attempts = 2;
}
class TransientGhSync extends Error {
  static attempts = 3;
}

function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set for StatsSyncJob`);
  return value;
}

/**
 * The daily `stats:sync --latest`, replacing cron-wrapper.sh: `retryOn` takes
 * the wrapper's two retry loops, and the log keeps its `=== <time> ===` headers
 * and `[cron-wrapper]` verdict lines, and a run that fails for good mails
 * `EMAIL` through ApplicationJob's failure mail, as the wrapper's `send_alert`
 * did. It writes STATS_SYNC_DB, not stats.db, while the crontab still runs (docs/deploy.md).
 */
export class StatsSyncJob extends ApplicationJob {
  private failedStage: string | null = null;

  // Temporary: trails does not type this on Base (limits-concurrency-typed-on-activejob-base).
  declare static limitsConcurrency: (options: { key: string; duration: Duration }) => void;

  static {
    // A sync can outlive its retries' waits; a second one would race the first.
    this.limitsConcurrency({ key: "stats_sync", duration: Duration.hours(23) });
    this.retryOn(RateLimitedSync, { wait: Duration.seconds(120), attempts: RateLimitedSync.attempts });
    this.retryOn(TransientGhSync, { wait: Duration.seconds(1800), attempts: TransientGhSync.attempts });
  }

  async perform(): Promise<void> {
    const log = requiredEnv("STATS_SYNC_LOG");
    requiredEnv("STATS_SYNC_DB");
    const { currentStage, syncLatest } = await import("../../lib/stats-sync/sync.ts");
    getFs().mkdirSync(getPath().dirname(log), { recursive: true });
    this.reportGap(log);
    // Whole seconds, as the wrapper's `date -Iseconds`: btwhooks' run-header pattern has no `.`.
    getFs().appendFileSync(log, `=== ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} ===\n`);

    try {
      await syncLatest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retried = /rate limit|secondary rate|abuse detection/i.test(message)
        ? RateLimitedSync
        : isTransientGhError(message)
          ? TransientGhSync
          : null;
      const attempts = retried?.attempts ?? 1;
      const execution = this.executions ?? 1;
      const verdict =
        execution < attempts
          ? `retrying at stage "${currentStage()}" (execution ${execution} of ${attempts})`
          : `stats sync failed at stage "${currentStage()}" (execution ${execution}): ${message.split("\n")[0]}`;
      getFs().appendFileSync(log, `${message}\n[cron-wrapper] ${verdict}\n`);
      this.failedStage = currentStage();
      throw retried ? new retried(message) : error;
    }
    getFs().appendFileSync(log, "[cron-wrapper] ok\n");
    await this.reportMissingCompareData(log);
  }

  /**
   * Mail `EMAIL` the packages the packages pages would show "no data" for
   * without a reason, so a parser or summary gap is not found by eye.
   */
  private async reportMissingCompareData(log: string): Promise<void> {
    let packages;
    try {
      const { packagesMissingCompareData } = await import("../../lib/stats-sync/missing-compare-data.ts");
      packages = await packagesMissingCompareData();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      getFs().appendFileSync(log, `[cron-wrapper] missing-data check failed: ${cause}\n`);
      return;
    }
    if (packages.length === 0) return;
    getFs().appendFileSync(
      log,
      `[cron-wrapper] missing compare data: ${packages.map((p) => `${p.package} (${p.missing.join(", ")})`).join(", ")}\n`,
    );
    const to = env.EMAIL;
    if (!to) return;
    try {
      await StatsSyncMailer.missingCompareData({ to, packages }).deliverNow();
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      getFs().appendFileSync(log, `[cron-wrapper] missing-data email to ${to} could not be sent: ${cause}\n`);
    }
  }

  /**
   * The stage and the log tail, as cron-wrapper.sh's `send_alert` mailed them;
   * `ApplicationJob#mailFailure` sends them once the retries are spent.
   */
  protected override async failureDetails(): Promise<string | null> {
    const log = env.STATS_SYNC_LOG;
    const tail = log ? (await getFs().readFile(log, "utf8")).trimEnd().split("\n").slice(-30).join("\n") : "";
    return `Stage: ${this.failedStage ?? "(before the sync started)"}\n\nLast 30 lines:\n${tail}`;
  }

  /** An unsent alert is a `[cron-wrapper]` line in the log, as the wrapper wrote it. */
  protected override failureMailNotSent(reason: string): void {
    const log = env.STATS_SYNC_LOG;
    if (log) getFs().appendFileSync(log, `[cron-wrapper] ${reason}\n`);
    super.failureMailNotSent(reason);
  }

  private reportGap(log: string): void {
    if (!getFs().existsSync(log)) return;
    const contents = getFs().readFileSync(log, "utf8");
    const previous = [...contents.matchAll(/^=== (\d{4}-\d{2}-\d{2}T\S+) ===$/gm)].at(-1)?.[1];
    if (!previous) return;
    const hours = Math.floor((Date.now() - Date.parse(previous)) / 3_600_000);
    if (hours >= STALE_HOURS) {
      getFs().appendFileSync(
        log,
        `[cron-wrapper] stale: previous run was ${hours}h ago (expected ~24h) — the sync did not run in between\n`,
      );
    }
  }
}
