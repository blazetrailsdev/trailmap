/**
 * The daily rollup — the one query behind every line on `/graphs/parity`.
 *
 * ringo computes this with a `GROUP BY` and a bare-column `MAX()`, which is a
 * SQLite behaviour; this uses a window function, which is not. These cases pin
 * the behaviour that rewrite has to preserve: one row per (day, package), and
 * that row is the LAST PR merged that day.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ApiCompareStat } from "../../app/models/compare-stats.js";
import { createScratchStatsDatabase, seedApiCompare } from "./stats-schema.js";

const COLUMNS = ["matched", "total", "percent"];

beforeAll(async () => {
  await createScratchStatsDatabase();
  await seedApiCompare([
    // Two PRs merged the same day: the later one is where the package stood.
    { pr: 10, mergedAt: "2026-05-01T09:00:00Z", package: "arel", matched: 10, total: 20, percent: 50 },
    { pr: 11, mergedAt: "2026-05-01T17:30:00Z", package: "arel", matched: 15, total: 20, percent: 75 },
    // A second package on the same day, and a day with a single merge.
    { pr: 11, mergedAt: "2026-05-01T17:30:00Z", package: "i18n", matched: 5, total: 10, percent: 50 },
    { pr: 12, mergedAt: "2026-05-03T12:00:00Z", package: "arel", matched: 18, total: 20, percent: 90, missing: 2 },
    // A PR that was closed without merging contributes nothing.
    { pr: 13, mergedAt: "", package: "arel", matched: 0, total: 20, percent: 0 },
  ]);
});

describe("CompareRun.dailyRollup", () => {
  it("answers one row per day and package, from the last PR merged that day", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      columns: COLUMNS,
    }).toArray();

    expect(rows.map((row) => [(row as never as { day: string }).day, row.pr_number, row.percent])).toEqual([
      // 2026-05-01 is PR 11's number, not PR 10's: the later merge wins.
      ["2026-05-01", 11, 75],
      ["2026-05-03", 12, 90],
    ]);
  });

  it("skips a day with no merged PR rather than charting a zero", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      columns: COLUMNS,
    }).toArray();

    // 2026-05-02 had no merge, so the line spans the gap.
    expect(rows.map((row) => (row as never as { day: string }).day)).not.toContain("2026-05-02");
  });

  it("ignores a PR that was never merged", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      columns: COLUMNS,
    }).toArray();

    expect(rows.map((row) => row.pr_number)).not.toContain(13);
  });

  it("keeps the packages apart", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel", "i18n"],
      columns: COLUMNS,
    }).toArray();

    expect(rows.filter((row) => row.package === "i18n").map((row) => row.percent)).toEqual([50]);
  });

  it("bounds the window by day, inclusively", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      since: "2026-05-03",
      columns: COLUMNS,
    }).toArray();

    expect(rows.map((row) => (row as never as { day: string }).day)).toEqual(["2026-05-03"]);
  });

  it("selects the columns it was asked for, and only those", async () => {
    const [row] = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      since: "2026-05-03",
      columns: [...COLUMNS, "missing"],
    }).toArray();

    expect((row as never as { missing: number }).missing).toBe(2);
    // `misplaced` was not asked for, so it is not on the row at all — a metric
    // reading a column it did not select is a MissingAttributeError, which is
    // how the derived metrics were caught selecting the wrong list.
    expect(Object.keys(row as object)).not.toContain("misplaced");
  });

  it("narrows the asked-for columns to the ones this database has", async () => {
    const rows = await ApiCompareStat.dailyRollup({
      packages: ["arel"],
      // `files_mapped` belongs to test_compare_stats; a stats database older
      // than a counter is the real case this guards.
      columns: [...COLUMNS, "files_mapped"],
    }).toArray();

    expect(rows.length).toBeGreaterThan(0);
  });
});
