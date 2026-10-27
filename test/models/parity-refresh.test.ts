/**
 * When the page refreshes the projection, and when it declines to.
 *
 * Every branch of `refreshProjectionIfStale` is a decision about whether a GET
 * does write work, so each one is pinned here: no stats database, already
 * fresh, already locked, and actually stale. The staleness rule itself had a
 * bug that defeated the whole projection — measuring against the newest MERGED
 * PR rather than the newest MEASURED day, so a docs-only PR made every page
 * load believe it was stale — and "does nothing once the projection has caught
 * up" is the case that would have caught it.
 *
 * The stats fixture is built once for the file and is NOT reset between cases
 * (there are no migrations to replay for a schema trailmap does not own), so a
 * case that seeds a comparison row removes it again. The hub is truncated per
 * case as usual.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  hubTestUrl,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.ts";
import { Hub } from "../../app/models/hub.ts";
import { ParityDay } from "../../app/models/parity-day.ts";
import { projectionIsStale, refreshProjectionIfStale } from "../../app/models/parity-refresh.ts";
import { createScratchStatsDatabase, seedApiCompare } from "./stats-schema.ts";
import { Stats } from "../../app/models/stats.ts";

/** The lock `parity-refresh.ts` uses; taken here to drive the "locked" path. */
const REFRESH_LOCK = 0x7a11_0001;

/** The two seeded comparison rows, which every case starts from. */
const SEEDED_ROWS = 2;

/**
 * A hub connection of its OWN, for the case that needs two sessions.
 *
 * An advisory lock belongs to the backend session that took it, so "a refresh
 * is already running" cannot be staged on a connection of `Hub`'s pool: the
 * test harness gives it `pool: 1` (deliberately — see
 * test/support/hub-schema.ts), so a checkout from it would deadlock against
 * the refresh under test rather than contend with it. A subclass with its own
 * `establishConnection` gets its own pool, which is its own session.
 */
class OtherSession extends Hub {
  static {
    this.abstractClass = true;
  }
}

/** Run SQL against the scratch stats database. */
async function stats(sql: string): Promise<void> {
  const adapter = await Stats.connectionPool().leaseConnection();
  await adapter.execute(sql);
}

describe.skipIf(!hasHubTestDatabase())("refreshProjectionIfStale", () => {
  beforeAll(async () => {
    await connectHubTestDatabase();
    await createScratchStatsDatabase();
    await seedApiCompare([
      { pr: 10, mergedAt: "2026-05-01T09:00:00Z", package: "arel", matched: 10, total: 20, percent: 50 },
      { pr: 12, mergedAt: "2026-05-03T12:00:00Z", package: "arel", matched: 18, total: 20, percent: 90 },
    ]);
    // Only the gate in `refreshProjectionIfStale` reads this; the scratch
    // stats connection is already established, and in memory.
    setEnv("STATS_DB", ":memory:");
  }, HUB_SETUP_TIMEOUT);
  beforeEach(truncateHub);
  afterAll(releaseHubTestDatabase);

  it("fills an empty projection — the first page load after the migration", async () => {
    expect(await projectionIsStale()).toBe(true);

    const result = await refreshProjectionIfStale();

    expect(result).toEqual({ ran: true, rows: SEEDED_ROWS });
    expect(await ParityDay.count()).toBe(SEEDED_ROWS);
  });

  it("does nothing once the projection has caught up", async () => {
    await refreshProjectionIfStale();

    // The decisive case. A PR merged AFTER the newest comparison row — CI
    // failed, or it touched only docs — must not make this stale: measuring
    // against `pull_requests.merged_at` answers true here forever, and runs
    // the full eight-run rollup on every single page load.
    await stats(
      "INSERT INTO pull_requests (number, merge_commit_sha, merged_at) " +
        "VALUES (99, 'sha99', '2026-06-01T00:00:00Z')",
    );

    try {
      expect(await projectionIsStale()).toBe(false);
      expect(await refreshProjectionIfStale()).toEqual({ ran: false, why: "fresh" });
    } finally {
      await stats("DELETE FROM pull_requests WHERE number = 99");
    }
  });

  it("is stale again when a run measures a newer day", async () => {
    await refreshProjectionIfStale();
    expect(await projectionIsStale()).toBe(false);

    await seedApiCompare([
      { pr: 13, mergedAt: "2026-05-04T08:00:00Z", package: "arel", matched: 19, total: 20, percent: 95 },
    ]);

    try {
      expect(await projectionIsStale()).toBe(true);
      expect(await refreshProjectionIfStale()).toEqual({ ran: true, rows: SEEDED_ROWS + 1 });
      expect(await ParityDay.latestDay()).toBe("2026-05-04");
    } finally {
      await stats("DELETE FROM api_compare_stats WHERE pr_number = 13");
      await stats("DELETE FROM pull_requests WHERE number = 13");
    }
  });

  it("is stale when the newest day a run measured is missing from the projection", async () => {
    await refreshProjectionIfStale();
    expect(await projectionIsStale()).toBe(false);

    // The projection losing ground rather than the stats database gaining it:
    // the same comparison, since staleness is a comparison of the two maxima
    // and either side can move it.
    await ParityDay.where({ metric: "api", day: "2026-05-03" }).deleteAll();

    expect(await projectionIsStale()).toBe(true);
  });

  it("declines rather than queues when a refresh is already running", async () => {
    await OtherSession.establishConnection({
      adapter: "postgresql",
      url: hubTestUrl() as string,
      pool: 1,
    });
    const other = await OtherSession.connectionPool().leaseConnection();
    await other.execute(`SELECT pg_advisory_lock(${REFRESH_LOCK})`);

    try {
      // Non-blocking: `pg_try_advisory_lock` answers false immediately, so the
      // page renders what is in the projection instead of waiting on someone
      // else's write.
      expect(await refreshProjectionIfStale()).toEqual({ ran: false, why: "locked" });
      expect(await ParityDay.count()).toBe(0);
    } finally {
      await other.execute(`SELECT pg_advisory_unlock(${REFRESH_LOCK})`);
      // This pool only, never the handler's: `Hub`'s single connection is
      // holding the suite's own advisory lock (HUB_TEST_LOCK), and dropping it
      // would hand the hub to another test file mid-run.
      await OtherSession.connectionPool().disconnect();
    }
  });

  it("releases the lock, so the next load can refresh", async () => {
    await refreshProjectionIfStale();
    await ParityDay.deleteAll();

    // Would answer "locked" if the lock leaked — which is exactly what taking
    // and releasing it through two `withConnection` calls used to do, silently
    // and for the life of the process.
    expect(await refreshProjectionIfStale()).toEqual({ ran: true, rows: SEEDED_ROWS });
  });

  it("declines without a stats database, and leaves the projection alone", async () => {
    await refreshProjectionIfStale();
    setEnv("STATS_DB", undefined);

    try {
      // The deployment that has no 7 GB file: the page serves whatever the
      // last `pnpm parity:sync` left, and nothing here throws.
      expect(await refreshProjectionIfStale()).toEqual({ ran: false, why: "no-stats-database" });
      expect(await ParityDay.count()).toBe(SEEDED_ROWS);
    } finally {
      setEnv("STATS_DB", ":memory:");
    }
  });
});
