/**
 * The metric table: which comparison run each line charts, and out of what.
 *
 * The distinction these pin is the one the port got wrong first — gaps belong
 * to the METRIC, not to the table. Four metrics read `test_compare_stats` and
 * only one of them charts its counters, so keying gaps by table offered
 * `misplaced` and `skipped` under `test:compare files`, where they mean
 * nothing. The ringo gate caught it; this keeps it caught without a running
 * ringo.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  PARITY_METRICS,
  denominatorColumn,
  gapsFor,
  isNativeMetric,
  lookupParityMetric,
  metricAvailable,
  metricColumns,
  numeratorColumn,
} from "../../app/models/parity-metric.js";
import { createScratchStatsDatabase } from "./stats-schema.js";

beforeAll(async () => {
  await createScratchStatsDatabase();
});

describe("the metric table", () => {
  it("offers the eight runs the page's picker shows, in picker order", () => {
    expect(PARITY_METRICS.map((metric) => metric.key)).toEqual([
      "api",
      "api_privates",
      "test",
      "test_files",
      "test_assert_count",
      "test_assert_kind",
      "calls",
      "call_args",
    ]);
  });

  it("looks a metric up by key, and answers nothing for one it does not have", () => {
    expect(lookupParityMetric("test_files")?.label).toBe("test:compare files");
    expect(lookupParityMetric("no_such_run")).toBeUndefined();
  });

  it("reads four metrics out of the one test_compare_stats table", () => {
    const fromTests = PARITY_METRICS.filter(
      (metric) => metric.model.tableName === "test_compare_stats",
    );
    expect(fromTests.map((metric) => metric.key)).toEqual([
      "test",
      "test_files",
      "test_assert_count",
      "test_assert_kind",
    ]);
  });
});

describe("native and derived metrics", () => {
  it("treats a run's own matched/total ratio as native", () => {
    for (const key of ["api", "api_privates", "test", "calls", "call_args"]) {
      expect(isNativeMetric(lookupParityMetric(key)!)).toBe(true);
    }
  });

  it("treats the files and assertion ratios as derived", () => {
    for (const key of ["test_files", "test_assert_count", "test_assert_kind"]) {
      expect(isNativeMetric(lookupParityMetric(key)!)).toBe(false);
    }
  });

  it("reads percent only for a native metric, which is the column CI wrote", () => {
    expect(metricColumns(lookupParityMetric("api")!)).toContain("percent");
    expect(metricColumns(lookupParityMetric("test_files")!)).not.toContain("percent");
  });

  it("names the columns a derived metric actually reads", () => {
    const files = lookupParityMetric("test_files")!;
    expect(numeratorColumn(files)).toBe("files_mapped");
    expect(denominatorColumn(files)).toBe("files_total");
    expect(metricColumns(files)).toEqual(["files_mapped", "files_total"]);

    // The assertion metrics are "out of mapped tests, minus the mismatching
    // ones", so matched is both the numerator and the denominator.
    const counts = lookupParityMetric("test_assert_count")!;
    expect(numeratorColumn(counts)).toBe("matched");
    expect(denominatorColumn(counts)).toBe("matched");
    expect(metricColumns(counts)).toEqual(["matched", "assertion_count_mismatch"]);
  });
});

describe("gaps", () => {
  it("charts a run's counters under that run", () => {
    expect(gapsFor(lookupParityMetric("api")!)).toEqual(["misplaced", "missing"]);
    expect(gapsFor(lookupParityMetric("test")!)).toEqual([
      "misplaced",
      "skipped",
      "assertion_count_mismatch",
      "assertion_kind_mismatch",
    ]);
  });

  it("offers NO gaps for the metrics derived from the same table", () => {
    // Not [] — null, which is what ringo's JSON says, because the drawing code
    // reading it is ringo's own.
    expect(gapsFor(lookupParityMetric("test_files")!)).toBeNull();
    expect(gapsFor(lookupParityMetric("test_assert_count")!)).toBeNull();
    expect(gapsFor(lookupParityMetric("test_assert_kind")!)).toBeNull();
  });
});

describe("availability", () => {
  it("offers every metric this schema can chart", () => {
    for (const metric of PARITY_METRICS) {
      expect(metricAvailable(metric), metric.key).toBe(true);
    }
  });
});
