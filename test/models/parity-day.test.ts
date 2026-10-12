/**
 * The projection: the refresh that fills it, and the scope the page reads.
 *
 * Both halves are real. The stats side is the scratch SQLite database
 * `test/models/stats-schema.ts` builds on the adapter production uses, and the
 * hub side is a real Postgres — `parity_days` carries check constraints, a
 * `jsonb` column and a transactional per-metric swap, none of which SQLite
 * would be answering for. Only `api_compare_stats` is seeded; the other seven
 * runs have no packages, which is the path `refreshFromStats` skips.
 *
 * What these pin is the WRITE side — that a refresh REPLACES a run rather than
 * merging into it, that the numbers are measured on the way in, and that the
 * scope the page reads keeps runs and packages apart.
 * `scripts/gate-ringo-parity.ts` is what pins the numbers themselves against
 * ringo, over the live 7 GB file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import {
  connectHubTestDatabase,
  hasHubTestDatabase,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.js";
import { ParityDay } from "../../app/models/parity-day.js";
import { createScratchStatsDatabase, seedApiCompare } from "./stats-schema.js";

/** The seeded stats rows: two PRs merged on the 1st, one on the 3rd. */
const SEED = [
  { pr: 10, mergedAt: "2026-05-01T09:00:00Z", package: "arel", matched: 10, total: 20, percent: 50 },
  {
    pr: 11,
    mergedAt: "2026-05-01T17:30:00Z",
    package: "arel",
    matched: 15,
    total: 20,
    percent: 75,
    misplaced: 1,
    missing: 4,
  },
  { pr: 11, mergedAt: "2026-05-01T17:30:00Z", package: "i18n", matched: 5, total: 10, percent: 50 },
  {
    pr: 12,
    mergedAt: "2026-05-03T12:00:00Z",
    package: "arel",
    matched: 18,
    total: 20,
    percent: 90,
    missing: 2,
  },
];

/** One projected row, with the columns a case actually varies. */
function row(attributes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metric: "api",
    package: "arel",
    day: "2026-05-01",
    pr_number: 1,
    matched: 9,
    total: 10,
    percent: 90,
    gaps: null,
    ...attributes,
  };
}

describe.skipIf(!hasHubTestDatabase())("ParityDay", () => {
  beforeAll(async () => {
    await connectHubTestDatabase();
    await createScratchStatsDatabase();
    await seedApiCompare(SEED);
    // Only the gate in `refreshProjectionIfStale` reads this; the scratch
    // stats connection is already established, and in memory.
    setEnv("STATS_DB", ":memory:");
  });
  beforeEach(truncateHub);
  afterAll(releaseHubTestDatabase);

  describe("refreshFromStats", () => {
    it("projects one row per package and day, for each run that has rows", async () => {
      const { metrics, rows } = await ParityDay.refreshFromStats();

      // One metric, because only `api_compare_stats` is seeded; three rows,
      // because the 1st collapses two PRs into one row per package.
      expect({ metrics, rows }).toEqual({ metrics: 1, rows: 3 });
      expect(await ParityDay.count()).toBe(3);
      expect(await ParityDay.distinct().pluck("metric")).toEqual(["api"]);
    });

    it("takes the day's last merged PR, measured, not the first", async () => {
      await ParityDay.refreshFromStats();

      const stored = await ParityDay.where({ metric: "api", package: "arel", day: "2026-05-01" }).first();
      // PR 11, not PR 10: `dailyRollup` picks the later merge, and the numbers
      // travel with it.
      expect(stored?.pr_number).toBe(11);
      expect([stored?.matched, stored?.total]).toEqual([15, 20]);
      // The percent CI wrote, read rather than recomputed.
      expect(Number(stored?.percent)).toBe(75);
    });

    it("stores the run's own gap counters as jsonb", async () => {
      await ParityDay.refreshFromStats();

      const stored = await ParityDay.where({ package: "arel", day: "2026-05-01" }).first();
      // An object, not a JSON string: a string would mean the column had been
      // declared text somewhere, and the page would draw "[object Object]".
      expect(stored?.gaps).toEqual({ misplaced: 1, missing: 4 });
    });

    it("is idempotent — a second refresh leaves the same rows, not twice as many", async () => {
      await ParityDay.refreshFromStats();
      const before = await ParityDay.order({ id: "asc" }).pluck("package", "day", "matched");

      await ParityDay.refreshFromStats();

      expect(await ParityDay.count()).toBe(3);
      expect(await ParityDay.order({ id: "asc" }).pluck("package", "day", "matched")).toEqual(before);
    });

    it("REPLACES the run rather than merging into it, so an orphan is removed", async () => {
      // A package that stopped being compared, or a day whose rows moved when
      // a merge commit was reassigned. An upsert-only refresh leaves both
      // behind forever, which is what made "rebuildable" untrue.
      await ParityDay.insertAll([row({ package: "gone", day: "2026-04-01" })]);

      await ParityDay.refreshFromStats();

      expect(await ParityDay.where({ package: "gone" }).count()).toBe(0);
      expect(await ParityDay.count()).toBe(3);
    });

    it("leaves another run's rows alone — the swap is per metric", async () => {
      // `test` has no seeded stats rows, so the refresh never reaches it. A
      // global delete-then-fill would wipe this; a per-metric swap must not.
      await ParityDay.insertAll([row({ metric: "test", day: "2026-04-01" })]);

      await ParityDay.refreshFromStats();

      expect(await ParityDay.where({ metric: "test" }).count()).toBe(1);
    });
  });

  describe("the table's own guarantees", () => {
    it("identifies a row by (metric, package, day)", async () => {
      await ParityDay.insertAll([row()]);
      // The same package and day under a DIFFERENT run is a different row:
      // four of the eight metrics read `test_compare_stats`, so this is the
      // ordinary case rather than an edge one.
      await ParityDay.insertAll([row({ metric: "test" })]);

      expect(await ParityDay.count()).toBe(2);
    });

    it("SKIPS a conflicting insert rather than raising or overwriting", async () => {
      await ParityDay.insertAll([row({ matched: 9 })]);

      // `insertAll` is Rails' `insert_all`: `ON CONFLICT DO NOTHING`, so a
      // second row for the same (metric, package, day) is dropped silently and
      // the first one stands. Worth pinning, because it is the reason
      // `refreshFromStats` DELETES a metric's rows before inserting instead of
      // inserting over them — doing the latter would quietly keep the old
      // numbers and report a row count that never happened.
      await ParityDay.insertAll([row({ matched: 1 })]);

      expect(await ParityDay.count()).toBe(1);
      expect((await ParityDay.first())?.matched).toBe(9);
    });

    it("refuses matching more than was compared", async () => {
      await expect(ParityDay.insertAll([row({ matched: 11, total: 10 })])).rejects.toThrow();
    });

    it("refuses a percent outside 0..100", async () => {
      await expect(ParityDay.insertAll([row({ percent: 101 })])).rejects.toThrow();
    });
  });

  describe("forChart", () => {
    beforeEach(async () => {
      await ParityDay.refreshFromStats();
    });

    it("answers one run's rows for the named packages, oldest day first", async () => {
      const rows = await ParityDay.forChart("api", ["arel"]).toArray();
      // Ascending, because a chart line is read in order — and the rows did
      // not arrive in this order.
      expect(rows.map((r) => String(r.day))).toEqual(["2026-05-01", "2026-05-03"]);
    });

    it("keeps the packages apart", async () => {
      const rows = await ParityDay.forChart("api", ["i18n"]).toArray();
      expect(rows.map((r) => r.package)).toEqual(["i18n"]);
    });

    it("keeps the runs apart", async () => {
      expect(await ParityDay.forChart("test", ["arel"]).toArray()).toEqual([]);
    });

    it("bounds the window inclusively from `since`", async () => {
      const rows = await ParityDay.forChart("api", ["arel"], "2026-05-03").toArray();
      expect(rows.map((r) => String(r.day))).toEqual(["2026-05-03"]);
    });
  });

  describe("latestDay", () => {
    it("answers null for an empty projection", async () => {
      expect(await ParityDay.latestDay()).toBeNull();
    });

    it("answers the newest day as ten ISO characters", async () => {
      await ParityDay.refreshFromStats();
      // The PG adapter answers a `date` as a `Temporal.PlainDate`, whose
      // `toString` is ISO. A JS `Date` would stringify to "Sun May 03 2026 …"
      // and make every day comparison in parity-refresh.ts silently wrong, so
      // the format is pinned rather than assumed.
      expect(await ParityDay.latestDay()).toBe("2026-05-03");
    });
  });
});
