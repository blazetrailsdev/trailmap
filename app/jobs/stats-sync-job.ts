import { Duration } from "@blazetrails/activesupport";
import { env, getFs, getPath, registerConstant } from "@blazetrails/ruby-compat";
import { isTransientGhError } from "../../lib/stats-sync/gh-transient-error.ts";
import { ApplicationJob } from "./application-job.ts";

const STALE_HOURS = 26;

class RateLimitedSync extends Error {}
class TransientGhSync extends Error {}

function requiredEnv(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} must be set for StatsSyncJob`);
  return value;
}

/**
 * The daily `stats:sync --latest`, replacing cron-wrapper.sh: `retryOn` takes
 * the wrapper's two retry loops, and the log keeps its `=== <time> ===` headers
 * and `[cron-wrapper]` verdict lines. It writes STATS_SYNC_DB, not stats.db,
 * while the crontab still runs (docs/deploy.md).
 */
export class StatsSyncJob extends ApplicationJob {
  declare static limitsConcurrency: (options: { key: string; duration: Duration }) => void;

  static {
    // A sync can outlive its retries' waits; a second one would race the first.
    this.limitsConcurrency({ key: "stats_sync", duration: Duration.hours(23) });
    this.retryOn(RateLimitedSync, { wait: 120, attempts: 2 });
    this.retryOn(TransientGhSync, { wait: 1800, attempts: 3 });
  }

  async perform(): Promise<void> {
    const log = requiredEnv("STATS_SYNC_LOG");
    requiredEnv("STATS_SYNC_DB");
    const { currentStage, syncLatest } = await import("../../lib/stats-sync/sync.ts");
    getFs().mkdirSync(getPath().dirname(log), { recursive: true });
    this.reportGap(log);
    getFs().appendFileSync(log, `=== ${new Date().toISOString()} ===\n`);

    try {
      await syncLatest();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const firstLine = message.split("\n")[0];
      getFs().appendFileSync(
        log,
        `[cron-wrapper] stats sync failed at stage "${currentStage()}" (attempt ${this.executions ?? 0}): ${firstLine}\n`,
      );
      if (/rate limit|secondary rate|abuse detection/i.test(message)) {
        throw new RateLimitedSync(message);
      }
      if (isTransientGhError(message)) throw new TransientGhSync(message);
      throw error;
    }
    getFs().appendFileSync(log, "[cron-wrapper] ok\n");
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

registerConstant("StatsSyncJob", StatsSyncJob);
