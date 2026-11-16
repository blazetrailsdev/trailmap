import { Duration } from "@blazetrails/activesupport";
import { env, getFs, getPath } from "@blazetrails/ruby-compat";
import { isTransientGhError } from "../../lib/stats-sync/gh-transient-error.ts";
import { StatsSyncMailer } from "../mailers/stats-sync-mailer.ts";
import { ApplicationJob } from "./application-job.ts";

const STALE_HOURS = 3;
// A GitHub outage fails every hourly run; mail once it has outlasted a few of them.
const FAILED_RUNS_BEFORE_MAIL = 3;

// `attempts` is total executions, as retry_on counts them: the wrapper's run plus its retries.
class RateLimitedSync extends Error {
  static attempts = 2;
}
// One retry, soon: the next hourly run is the real retry, so a retried run ends before it starts.
class TransientGhSync extends Error {
  static attempts = 2;
}

// Every log read needs only the last few runs, and the log grows by 24 runs a day.
const LOG_TAIL_BYTES = 64 * 1024;

function readLogTail(log: string): string {
  const fs = getFs();
  const size = fs.statSync(log).size;
  const length = Math.min(size, LOG_TAIL_BYTES);
  const buffer = new Uint8Array(length);
  const fd = fs.openSync(log, "r");
  try {
    fs.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs.closeSync(fd);
  }
  return new TextDecoder().decode(buffer);
}

function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set for StatsSyncJob`);
  return value;
}

/**
 * The hourly `stats:sync --latest`, replacing cron-wrapper.sh: `retryOn` takes
 * the wrapper's two retry loops, and the log keeps its `=== <time> ===` headers
 * and `[cron-wrapper]` verdict lines, and a run that fails for good mails
 * `EMAIL` through ApplicationJob's failure mail, as the wrapper's `send_alert`
 * did. It writes STATS_SYNC_DB, not stats.db, while the crontab still runs (docs/deploy.md).
 */
export class StatsSyncJob extends ApplicationJob {
  private failedStage: string | null = null;

  static {
    // A sync (~13 min) can outlive its retries' waits; a second one would race the first.
    // solid_queue v1.1.3 has no `on_conflict: :discard`, so an overlapping run waits
    // for the lock, which expires after 2 hours if a run dies holding it.
    this.limitsConcurrency({ key: "stats_sync", duration: Duration.hours(2) });
    this.retryOn(RateLimitedSync, { wait: Duration.seconds(120), attempts: RateLimitedSync.attempts });
    this.retryOn(TransientGhSync, { wait: Duration.seconds(300), attempts: TransientGhSync.attempts });
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
   * Mail once per outage: on the `FAILED_RUNS_BEFORE_MAIL`th run in a row to fail
   * for good, counted from the log's `[cron-wrapper]` verdicts since its last `ok`.
   * A failure before the sync started (no env, no log directory, a failed import)
   * writes its verdict here, as perform's `catch` never saw it. Without a log to
   * count in, every failure mails.
   */
  override async mailFailure(exception: unknown): Promise<void> {
    const failed = this.consecutiveFailedRuns(exception);
    if (failed !== null && failed !== FAILED_RUNS_BEFORE_MAIL) {
      this.failureMailNotSent(
        failed < FAILED_RUNS_BEFORE_MAIL
          ? `no alert email sent: ${failed} failed run(s) in a row, mailing at ${FAILED_RUNS_BEFORE_MAIL}`
          : `no alert email sent: ${failed} failed runs in a row, mailed at ${FAILED_RUNS_BEFORE_MAIL}`,
      );
      return;
    }
    await super.mailFailure(exception);
  }

  /** `null` where there is no log to count in. */
  private consecutiveFailedRuns(exception: unknown): number | null {
    const log = env.STATS_SYNC_LOG;
    if (!log) return null;
    try {
      if (this.failedStage === null) {
        const message = exception instanceof Error ? exception.message : String(exception);
        getFs().appendFileSync(
          log,
          `[cron-wrapper] stats sync failed before the sync started: ${message.split("\n")[0]}\n`,
        );
      }
      const sinceOk = readLogTail(log).split("[cron-wrapper] ok\n").at(-1) ?? "";
      return [...sinceOk.matchAll(/^\[cron-wrapper\] stats sync failed /gm)].length;
    } catch {
      return null;
    }
  }

  /**
   * The stage and the log tail, as cron-wrapper.sh's `send_alert` mailed them;
   * `ApplicationJob#mailFailure` sends them once the retries are spent.
   */
  protected override async failureDetails(): Promise<string[]> {
    const log = env.STATS_SYNC_LOG;
    let tail = "";
    // A log that cannot be read costs the mail its tail, not the mail itself.
    try {
      if (log) tail = readLogTail(log).trimEnd().split("\n").slice(-30).join("\n");
    } catch (error) {
      tail = `(the log could not be read: ${error instanceof Error ? error.message : String(error)})`;
    }
    return [`Stage: ${this.failedStage ?? "(before the sync started)"}`, "", "Last 30 lines:", tail];
  }

  /** An unsent alert is a `[cron-wrapper]` line in the log, as the wrapper wrote it. */
  protected override failureMailNotSent(reason: string): void {
    const log = env.STATS_SYNC_LOG;
    if (log) getFs().appendFileSync(log, `[cron-wrapper] ${reason}\n`);
    super.failureMailNotSent(reason);
  }

  private reportGap(log: string): void {
    if (!getFs().existsSync(log)) return;
    const contents = readLogTail(log);
    const previous = [...contents.matchAll(/^=== (\d{4}-\d{2}-\d{2}T\S+) ===$/gm)].at(-1)?.[1];
    if (!previous) return;
    const hours = Math.floor((Date.now() - Date.parse(previous)) / 3_600_000);
    if (hours >= STALE_HOURS) {
      getFs().appendFileSync(
        log,
        `[cron-wrapper] stale: previous run was ${hours}h ago (expected ~1h) — the sync did not run in between\n`,
      );
    }
  }
}
