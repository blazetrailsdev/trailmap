/**
 * The two halves of turning comparison rows into the chart's JSON.
 *
 * The arithmetic (`measureRow`) now happens ONCE, when the projection is
 * built, and the serializer is a pure mapping over rows that are already
 * measured. They are tested apart because that split is the point: measuring
 * twice is not a no-op, and the case below proves it.
 *
 * The output shape is a cross-repo contract — the code consuming it is ringo's,
 * vendored verbatim — so a field renamed or a percent rounded differently here
 * is a chart that draws wrong rather than a test that fails.
 */
import { describe, expect, it } from "vitest";
import type { ParityDay } from "../../app/models/parity-day.ts";
import { measureRow } from "../../app/models/parity-day.ts";
import { lookupParityMetric } from "../../app/models/parity-metric.ts";
import { serializeParitySeries } from "../../app/serializers/parity-json.ts";

/** A projected row, as `ParityDay.forChart` hands it over: already measured. */
function projected(attributes: Record<string, unknown>): ParityDay {
  return { gaps: null, ...attributes } as unknown as ParityDay;
}

describe("measureRow", () => {
  it("reads the percent CI wrote for a native metric rather than recomputing it", () => {
    // 6920/6959 is 99.439…, which rounds to 99.4; CI wrote 99.5. Reading the
    // column is what stops trailmap and CI disagreeing in the last decimal.
    expect(
      measureRow({ matched: 6920, total: 6959, percent: 99.5 }, lookupParityMetric("api")!),
    ).toEqual({ matched: 6920, total: 6959, percent: 99.5 });
  });

  it("computes a derived metric's percent to one decimal, as CI writes it", () => {
    // 2/3 is 66.666…
    expect(
      measureRow({ files_mapped: 2, files_total: 3 }, lookupParityMetric("test_files")!),
    ).toMatchObject({ matched: 2, total: 3, percent: 66.7 });
  });

  it("subtracts the mismatching assertions from the numerator, out of mapped tests", () => {
    expect(
      measureRow(
        { matched: 100, assertion_count_mismatch: 25 },
        lookupParityMetric("test_assert_count")!,
      ),
    ).toEqual({ matched: 75, total: 100, percent: 75 });
  });

  it("answers zero rather than dividing by zero", () => {
    expect(
      measureRow({ files_mapped: 0, files_total: 0 }, lookupParityMetric("test_files")!).percent,
    ).toBe(0);
  });

  it("is not idempotent, which is why the serializer must not repeat it", () => {
    // THE reason the arithmetic lives in one place. An assertion metric's
    // denominator is `matched`, so measuring an already-measured row divides a
    // number by itself: a silent 100% on a chart that should read 75%.
    const metric = lookupParityMetric("test_assert_count")!;
    const once = measureRow({ matched: 100, assertion_count_mismatch: 25 }, metric);
    expect(once.percent).toBe(75);

    const twice = measureRow({ ...once }, metric);
    expect(twice.percent).toBe(100);
    expect(twice.percent).not.toBe(once.percent);
  });
});

describe("serializeParitySeries", () => {
  it("maps a projected row to a point without touching its numbers", () => {
    const [series] = serializeParitySeries(
      [
        projected({
          day: "2026-10-10",
          package: "arel",
          pr_number: 8732,
          matched: 75,
          total: 100,
          percent: 75,
        }),
      ],
      "test_assert_count",
      ["arel"],
    );

    expect(series.points[0]).toEqual({
      date: "2026-10-10",
      pr: 8732,
      percent: 75,
      matched: 75,
      total: 100,
    });
  });

  it("carries the gap counts a row stored, and omits the key when it stored none", () => {
    const [withGaps] = serializeParitySeries(
      [
        projected({
          day: "2026-10-10",
          package: "arel",
          pr_number: 1,
          matched: 9,
          total: 10,
          percent: 90,
          gaps: { misplaced: 2, missing: 1 },
        }),
      ],
      "api",
      ["arel"],
    );
    expect(withGaps.points[0].gaps).toEqual({ misplaced: 2, missing: 1 });

    const [without] = serializeParitySeries(
      [
        projected({
          day: "2026-10-10",
          package: "arel",
          pr_number: 1,
          matched: 9,
          total: 10,
          percent: 90,
        }),
      ],
      "test_files",
      ["arel"],
    );
    expect(without.points[0].gaps).toBeUndefined();
  });

  it("returns the series in the order the packages were asked for, not the rows' order", () => {
    const rows = [
      projected({ day: "2026-10-10", package: "i18n", pr_number: 1, matched: 1, total: 2, percent: 50 }),
      projected({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 }),
    ];

    // The page assigns a colour from the package's position in this list, so a
    // series order that followed the rows would repaint on every filter change.
    expect(serializeParitySeries(rows, "api", ["arel", "i18n"]).map((s) => s.package)).toEqual([
      "arel",
      "i18n",
    ]);
  });

  it("drops a package with no rows rather than charting an empty line", () => {
    const series = serializeParitySeries(
      [projected({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 })],
      "api",
      ["arel", "never-measured"],
    );

    expect(series.map((one) => one.package)).toEqual(["arel"]);
  });

  it("stamps every series with the metric it was asked for", () => {
    const [series] = serializeParitySeries(
      [projected({ day: "2026-10-10", package: "arel", pr_number: 1, matched: 1, total: 2, percent: 50 })],
      "api_privates",
      ["arel"],
    );

    expect(series.metric).toBe("api_privates");
  });
});
