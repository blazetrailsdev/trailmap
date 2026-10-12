import { Hub } from "./hub.js";
import { ParityDay } from "./parity-day.js";
import { hasStatsDatabase } from "../../config/database.js";

/**
 * Keeping `parity_days` up to date, from the page that reads it.
 *
 * There is no cron. The projection is refreshed by whoever loads
 * `/graphs/parity` when it has fallen behind the stats database, and by
 * `pnpm parity:sync` when someone wants to force it. Both go through here.
 *
 * Refreshing on a GET is the cost of having no scheduler, and it is bounded
 * two ways: the staleness check means a page load usually does nothing at all,
 * and the advisory lock means a concurrent load does nothing rather than
 * queueing behind a refresh that is already running.
 */

/**
 * The lock key. Any 64-bit integer identifies a Postgres advisory lock; this
 * one is arbitrary and only has to be stable and unused elsewhere in this
 * database. Advisory locks are per-database, and the hub has no other.
 */
const REFRESH_LOCK = 0x7a11_0001;

/**
 * Whether the projection is behind the stats database.
 *
 * Compares the newest day the projection holds against the newest day the
 * stats database has a merged PR for. Both are one cheap query; neither reads
 * the comparison tables, which are the big ones.
 *
 * An EMPTY projection is stale by definition — that is the first page load
 * after the migration, and it is what fills the table.
 */
export async function projectionIsStale(): Promise<boolean> {
  const { PullRequest } = await import("./pull-request.js");
  const projected = await ParityDay.latestDay();
  if (projected === null) return true;

  const merged = await PullRequest.where("merged_at IS NOT NULL AND merged_at != ''").maximum(
    "merged_at",
  );
  if (merged == null) return false;
  // `merged_at` is an ISO timestamp and `day` is a date; the first ten
  // characters are the comparable part.
  return String(merged).slice(0, 10) > String(projected).slice(0, 10);
}

/**
 * Refresh the projection if it is behind and nothing else is already doing it.
 *
 * Answers what it did, so a caller can say so: `pnpm parity:sync` prints it and
 * the page ignores it.
 *
 * `pg_try_advisory_lock` rather than `pg_advisory_lock`: it returns false
 * immediately when the lock is held instead of blocking. A page load that
 * arrives during a refresh should render the data that is there, not wait for
 * someone else's write.
 */
export async function refreshProjectionIfStale(): Promise<
  { ran: false; why: "no-stats-database" | "fresh" | "locked" } | { ran: true; rows: number }
> {
  // Without the stats database there is nothing to refresh FROM. The
  // projection may still have rows from a previous host-side sync, and the
  // page serves them.
  if (!hasStatsDatabase()) return { ran: false, why: "no-stats-database" };
  if (!(await projectionIsStale())) return { ran: false, why: "fresh" };

  const lockRows = await withHubConnection(
    `SELECT pg_try_advisory_lock(${REFRESH_LOCK}) AS locked`,
  );
  if (!firstBoolean(lockRows)) return { ran: false, why: "locked" };

  try {
    const { rows } = await ParityDay.refreshFromStats();
    return { ran: true, rows };
  } finally {
    await withHubConnection(`SELECT pg_advisory_unlock(${REFRESH_LOCK})`);
  }
}

/**
 * Run something against the hub connection.
 *
 * Advisory locks have no ActiveRecord surface in trails — they are a Postgres
 * feature with no Rails API beyond the one the migrator uses internally — so
 * this is SQL. The key is a constant above, never interpolated from a request.
 */
async function withHubConnection(sql: string): Promise<unknown> {
  return Hub.connectionPool().withConnection((connection) =>
    (connection as unknown as { execute(sql: string): Promise<unknown> }).execute(sql),
  );
}

/** The one boolean a `pg_*_advisory_lock` call answers, however it is shaped. */
function firstBoolean(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const first: unknown = rows[0];
  if (typeof first === "boolean") return first;
  if (first && typeof first === "object") {
    const value = Object.values(first as Record<string, unknown>)[0];
    return value === true || value === "t" || value === 1;
  }
  return false;
}
