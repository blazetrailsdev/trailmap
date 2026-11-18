import { Duration } from "@blazetrails/activesupport";
import { env, getFs, getPath } from "@blazetrails/ruby-compat";
import { isTransientGhError } from "../../lib/stats-sync/gh-transient-error.ts";
import { StatsSyncMailer } from "../mailers/stats-sync-mailer.ts";
import { ApplicationJob } from "./application-job.ts";

const STALE_HOURS = 3;
// Below the 2h lock, leaving 20 minutes for the work around the sync (log trim,
// missing-data check). A retry is a new job (retry_on re-enqueues it) that takes
// the lock again once this execution releases it, so each execution gets its own
// lock and its own deadline: a run that hangs stops before its lock expires.
export const RUN_DEADLINE_MINUTES = 100;
// STATS_SYNC_LOG keeps whole runs from the last LOG_KEEP_DAYS, trimmed once it
// passes LOG_TRIM_BYTES, so most runs never rewrite it.
export const LOG_KEEP_DAYS = 14;
export const LOG_TRIM_BYTES = 4 * 1024 * 1024;
const RUN_HEADER = /^=== (\d{4}-\d{2}-\d{2}T\S+) ===$/gm;

/**
 * Drop the runs whose `=== <time> ===` header is older than LOG_KEEP_DAYS. The
 * cut falls on a header, so every kept run keeps its header and `[cron-wrapper]`
 * lines, the ones btwhooks' stats watcher reads. Written beside it and renamed
 * over it, so a reader never sees half a log.
 */
export async function trimLog(log: string, now = Date.now()): Promise<void> {
  const fs = getFs();
  if (!(await fs.exists(log)) || (await fs.stat!(log)).size <= LOG_TRIM_BYTES) return;
  const text = await fs.readFile(log, "utf-8");
  const cutoff = now - LOG_KEEP_DAYS * 86_400_000;
  const headers = [...text.matchAll(RUN_HEADER)];
  // The last run is always kept, so reportGap still sees an outage longer than LOG_KEEP_DAYS.
  const first = headers.find((m) => Date.parse(m[1]) >= cutoff) ?? headers.at(-1);
  const start = first?.index ?? 0;
  if (start === 0) return;
  try {
    await fs.writeFile!(`${log}.trim`, text.slice(start));
    await fs.rename!(`${log}.trim`, log);
  } catch (error) {
    await fs.rm!(`${log}.trim`, { force: true });
    throw error;
  }
}
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

// The log grows by 24 runs a day, and a run writes every failed `gh` call into it, so
// reads go backwards from the end, 64 KiB at a time, until `enough` has what it needs.
const LOG_CHUNK_BYTES = 64 * 1024;

function readLogTail(log: string, enough: (tail: string) => boolean = () => true): string {
  const fs = getFs();
  const size = fs.statSync(log).size;
  const fd = fs.openSync(log, "r");
  let bytes = new Uint8Array(0);
  let start = size;
  let tail = "";
  try {
    do {
      const length = Math.min(start, LOG_CHUNK_BYTES);
      start -= length;
      const chunk = new Uint8Array(length);
      fs.readSync(fd, chunk, 0, length, start);
      const joined = new Uint8Array(chunk.length + bytes.length);
      joined.set(chunk);
      joined.set(bytes, chunk.length);
      bytes = joined;
      tail = new TextDecoder().decode(bytes);
    } while (start > 0 && !enough(tail));
  } finally {
    fs.closeSync(fd);
  }
  return tail;
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
    // An hourly run that overlaps a running one is dropped, not queued behind it: the
    // next hour's run syncs the same data. The lock expires after 2 hours if a run
    // dies holding it.
    this.limitsConcurrency({ key: "stats_sync", duration: Duration.hours(2), onConflict: "discard" });
    this.retryOn(RateLimitedSync, { wait: Duration.seconds(120), attempts: RateLimitedSync.attempts });
    this.retryOn(TransientGhSync, { wait: Duration.seconds(300), attempts: TransientGhSync.attempts });
  }

  async perform(): Promise<void> {
    const log = requiredEnv("STATS_SYNC_LOG");
    requiredEnv("STATS_SYNC_DB");
    const { currentStage, SyncDeadlineExceededError, syncLatest } = await import("../../lib/stats-sync/sync.ts");
    getFs().mkdirSync(getPath().dirname(log), { recursive: true });
    try {
      await trimLog(log);
    } catch (error) {
      getFs().appendFileSync(log, `[cron-wrapper] log trim failed: ${error instanceof Error ? error.message : error}\n`);
    }
    this.reportGap(log);
    // Whole seconds, as the wrapper's `date -Iseconds`: btwhooks' run-header pattern has no `.`.
    getFs().appendFileSync(log, `=== ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} ===\n`);

    try {
      await syncLatest({ deadlineMinutes: RUN_DEADLINE_MINUTES });
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
        error instanceof SyncDeadlineExceededError
          ? `stats sync failed at stage "${currentStage()}" (execution ${execution}): deadline of ${RUN_DEADLINE_MINUTES} min exceeded`
          : execution < attempts
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
      const countFailed = (text: string) => [...text.matchAll(/^\[cron-wrapper\] stats sync failed /gm)].length;
      const tail = readLogTail(
        log,
        (text) => text.includes("[cron-wrapper] ok\n") || countFailed(text) > FAILED_RUNS_BEFORE_MAIL,
      );
      return countFailed(tail.split("[cron-wrapper] ok\n").at(-1) ?? "");
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
    const contents = readLogTail(log, (text) => /^=== \d{4}-\d{2}-\d{2}T\S+ ===$/m.test(text));
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
