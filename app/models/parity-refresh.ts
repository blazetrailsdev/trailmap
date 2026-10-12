import { Hub } from "./hub.js";
import { ParityDay } from "./parity-day.js";
import { PARITY_METRICS } from "./parity-metric.js";
import { hasStatsDatabase } from "../../config/database.js";

/**
 * Keeping `parity_days` up to date, from the page that reads it.
 *
 * There is no cron. The projection is refreshed by whoever loads
 * `/graphs/parity` when it has fallen behind the stats database, and by
 * `pnpm parity:sync` when someone wants to force it. Both go through here.
 *
 * Refreshing on a GET is the cost of having no scheduler, and it is bounded
 * three ways: the staleness check means a page load usually does nothing at
 * all; the advisory lock means a concurrent load does nothing rather than
 * queueing behind a refresh already running; and the caller renders whatever
 * is in the projection if this throws.
 */

/**
 * The advisory lock key.
 *
 * Any signed 64-bit integer identifies a Postgres advisory lock. This one is
 * arbitrary; it only has to be stable and unused elsewhere in this database.
 * It cannot collide with the MIGRATOR's lock, which Rails derives from a hash
 * of the database name (`generate_migrator_advisory_lock_id`) into the same
 * space — not because a hash cannot land here, but because the migrator holds
 * its lock only for the length of `db migrate` and this one only inside a
 * refresh, and a collision would cost at worst one skipped refresh, never
 * corruption. Both are advisory: nothing but these two call sites consults
 * them.
 */
const REFRESH_LOCK = 0x7a11_0001;

/**
 * Whether the projection is behind the stats database.
 *
 * Compares, PER METRIC, the newest day the projection holds against the newest
 * day that metric's comparison table actually has a row for.
 *
 * Deliberately NOT against `pull_requests.merged_at`, which was the first
 * version and was wrong in a way that defeated the whole projection: a PR can
 * merge and produce no comparison rows at all — CI failed, or it touched only
 * docs — so the newest merged PR runs permanently ahead of the newest measured
 * day, every page load believes it is stale, and every page load runs the full
 * eight-run rollup this exists to avoid.
 *
 * Per metric rather than globally for the same reason: one run lagging behind
 * the others is invisible to a single max.
 *
 * An EMPTY projection is stale by definition — the first page load after the
 * migration, which is what fills the table.
 */
export async function projectionIsStale(): Promise<boolean> {
  if ((await ParityDay.count()) === 0) return true;

  for (const metric of PARITY_METRICS) {
    const measured = await newestMeasuredDay(metric.model);
    if (measured === null) continue;

    const projected = await ParityDay.where({ metric: metric.key }).maximum("day");
    if (projected == null) return true;
    if (measured > isoDay(projected)) return true;
  }
  return false;
}

/**
 * The newest day one comparison table has a row for, as `YYYY-MM-DD`.
 *
 * Joined through `pull_requests` because the comparison tables carry no date
 * of their own — the same join `CompareRun.dailyRollup` makes, and on the same
 * indexed column.
 */
async function newestMeasuredDay(model: (typeof PARITY_METRICS)[number]["model"]): Promise<string | null> {
  const [row] = (await model
    .joins(
      "INNER JOIN pull_requests p ON p.merge_commit_sha = " +
        `${model.tableName}.merge_commit_sha`,
    )
    .where("p.merged_at IS NOT NULL AND p.merged_at != ''")
    .select("MAX(substr(p.merged_at, 1, 10)) AS day")
    .toArray()) as unknown as { day: string | null }[];
  return row?.day ?? null;
}

/**
 * A `day` value as `YYYY-MM-DD`.
 *
 * The PostgreSQL adapter answers a `date` column as a `Temporal.PlainDate`,
 * not a JS `Date`, and `PlainDate#toString` is ISO — so this is already the
 * right ten characters. Measured, not assumed: a JS `Date` would stringify to
 * `"Mon Oct 12 2026 …"` and make every comparison here silently wrong, so the
 * slice stays as the guard that would catch such a change, and
 * `parity-refresh.test.ts` pins the format.
 */
function isoDay(value: unknown): string {
  return String(value).slice(0, 10);
}

/**
 * Refresh the projection if it is behind and nothing else is already doing it.
 *
 * Answers what it did, so a caller can say so: `pnpm parity:sync` prints it and
 * the page ignores it.
 *
 * The lock and the refresh share ONE connection, which is the whole reason
 * this is shaped as a single `withConnection` block. A Postgres advisory lock
 * belongs to the backend session that took it, and `withConnection` checks a
 * connection out and back per call — so taking and releasing through two calls
 * can release on a different backend, which is a silent no-op that leaves the
 * lock held for the life of the process and makes every later refresh answer
 * "locked" forever. Rails pins the connection for the critical section too
 * (`Migration#with_advisory_lock`).
 *
 * `getAdvisoryLock` is `pg_try_advisory_lock`: it answers false immediately
 * when the lock is held rather than blocking, so a page load that arrives
 * during a refresh renders what is there instead of waiting on someone else's
 * write.
 */
export async function refreshProjectionIfStale(): Promise<
  { ran: false; why: "no-stats-database" | "fresh" | "locked" } | { ran: true; rows: number }
> {
  // Without the stats database there is nothing to refresh FROM. The
  // projection keeps whatever a previous sync left, and the page serves it.
  if (!hasStatsDatabase()) return { ran: false, why: "no-stats-database" };
  if (!(await projectionIsStale())) return { ran: false, why: "fresh" };

  return Hub.connectionPool().withConnection(async (connection) => {
    const pg = connection as unknown as {
      getAdvisoryLock(id: number): Promise<boolean>;
      releaseAdvisoryLock(id: number): Promise<boolean>;
    };

    if (!(await pg.getAdvisoryLock(REFRESH_LOCK))) return { ran: false as const, why: "locked" as const };

    try {
      const { rows } = await ParityDay.refreshFromStats();
      return { ran: true as const, rows };
    } finally {
      // Checked rather than fired and forgotten: a false here means the lock
      // was not ours to release, which is the symptom of the two-connection
      // bug above and is worth saying out loud rather than leaking silently.
      if (!(await pg.releaseAdvisoryLock(REFRESH_LOCK))) {
        console.warn(
          `parity refresh: advisory lock ${REFRESH_LOCK} was not held by this connection on release`,
        );
      }
    }
  });
}
