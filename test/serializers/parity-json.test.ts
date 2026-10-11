/**
 * The series shape the chart reads.
 *
 * This is a cross-repo contract in the same sense the read-models are: the
 * code consuming it is ringo's, vendored verbatim
 * (vendor/ringo/parity-draw.js), so a field renamed or a percent rounded
 * differently here is a chart that draws wrong rather than a test that fails.
 */
import { describe, expect, it } from "vitest";
import type { CompareRun } from "../../app/models/compare-run.js";
import { lookupParityMetric } from "../../app/models/parity-metric.js";
import { serializeParitySeries } from "../../app/serializers/parity-json.js";

/** A rollup row, as `dailyRollup` hands it over. */
function row(attributes: Record<string, unknown>): CompareRun {
  return attributes as unknown as CompareRun;
}

describe("serializeParitySeries", () => {
  it("reads the percent CI wrote for a native metric rather than recomputing it", () => {
    const [series] = serializeParitySeries(
      // 6920/6959 is 99.439…, which rounds to 99.4; CI wrote 99.4. The point
      // of reading the column is that a run whose percent disagrees with its
      // own counts still charts what CI reported.
      [row({ day: "2026-10-10", package: "arel", pr_number: 8732, matched: 6920, total: 6959, percent: 99.5 })],
      lookupParityMetric("api")!,
      ["arel"],
      [],
    );

    expect(series.points[0].percent).toBe(99.5);
    expect(series.points[0]).toEqual({
      date: "2026-10-10",
      pr: 8732,
      percent: 99.5,
      matched: 6920,
      total: 6959,
    });
  });

  it("computes a derived metric's percent to one decimal, as CI writes it", () => {
    const [series] = serializeParitySeries(
      [row({ day: "2026-10-10", package: "arel", pr_number: 1, files_mapped: 2, files_total: 3 })],
      lookupParityMetric("test_files")!,
      ["arel"],
      [],
    );

    // 2/3 is 66.666…, one decimal.
    expect(series.points[0]).toMatchObject({ percent: 66.7, matched: 2, total: 3 });
  });

  it("subtracts the mismatching assertions from the numerator, out of mapped tests", () => {
    const [series] = serializeParitySeries(
      [row({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 100, assertion_count_mismatch: 25 })],
      lookupParityMetric("test_assert_count")!,
      ["arel"],
      [],
    );

    expect(series.points[0]).toMatchObject({ matched: 75, total: 100, percent: 75 });
  });

  it("answers zero rather than dividing by zero", () => {
    const [series] = serializeParitySeries(
      [row({ day: "2026-10-10", package: "arel", pr_number: 1, files_mapped: 0, files_total: 0 })],
      lookupParityMetric("test_files")!,
      ["arel"],
      [],
    );

    expect(series.points[0].percent).toBe(0);
  });

  it("carries the gap counts it was asked for, and omits the key when there are none", () => {
    const attributes = { day: "2026-10-10", package: "arel", pr_number: 1, matched: 9, total: 10, percent: 90, misplaced: 2, missing: 1 };
    const [withGaps] = serializeParitySeries(
      [row(attributes)],
      lookupParityMetric("api")!,
      ["arel"],
      ["misplaced", "missing"],
    );
    expect(withGaps.points[0].gaps).toEqual({ misplaced: 2, missing: 1 });

    const [without] = serializeParitySeries([row(attributes)], lookupParityMetric("api")!, ["arel"], []);
    expect(without.points[0].gaps).toBeUndefined();
  });

  it("returns the series in the order the packages were asked for, not the rows' order", () => {
    const rows = [
      row({ day: "2026-10-10", package: "i18n", pr_number: 1, matched: 1, total: 2, percent: 50 }),
      row({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 }),
    ];

    // The page assigns a colour from the package's position in this list, so a
    // series order that followed the rows would repaint on every filter change.
    expect(
      serializeParitySeries(rows, lookupParityMetric("api")!, ["arel", "i18n"], []).map(
        (series) => series.package,
      ),
    ).toEqual(["arel", "i18n"]);
  });

  it("drops a package with no rows rather than charting an empty line", () => {
    const series = serializeParitySeries(
      [row({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 })],
      lookupParityMetric("api")!,
      ["arel", "never-measured"],
      [],
    );

    expect(series.map((one) => one.package)).toEqual(["arel"]);
  });

  it("stamps every series with the metric it came from", () => {
    const [series] = serializeParitySeries(
      [row({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 })],
      lookupParityMetric("api_privates")!,
      ["arel"],
      [],
    );

    expect(series.metric).toBe("api_privates");
  });
});
