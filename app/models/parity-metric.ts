import type { CompareRun } from "./compare-run.js";
import {
  ApiCallArgsStat,
  ApiCallsStat,
  ApiCompareStat,
  ApiComparePrivatesStat,
  TestCompareStat,
} from "./compare-stats.js";

/**
 * One measure the parity page can chart.
 *
 * A metric is NOT a table: `test_compare_stats` answers four of the eight,
 * because the same run writes several ratios. So a metric is a model plus the
 * two columns whose ratio it is, and the subtrahend if it is one of the
 * assertion checks.
 *
 * `num` / `den` default to the `matched` / `total` pair every run writes.
 * `sub` comes off the top of the numerator, which is how the advisory
 * assertion counters become parities of their own: mapped tests are the
 * denominator and the mismatching ones are subtracted.
 *
 * A VALUE object rather than a model, and a frozen list rather than a table:
 * these eight are a property of what CI runs, not rows anyone can add. Adding
 * a comparison run means adding an entry here and the page picks it up — the
 * controller and the view are driven entirely off this list, as ringo's are
 * off `parityMetrics` in webhook/parity.go.
 */
export interface ParityMetric {
  /** The `?metrics=` value and the key the JSON is grouped by. */
  readonly key: string;
  /** Shown in the page's run picker. */
  readonly label: string;
  readonly model: typeof CompareRun;
  readonly num?: string;
  readonly den?: string;
  readonly sub?: string;
  /**
   * The extra counters to chart as this metric's "gaps" series.
   *
   * On the METRIC, not the model. `test_compare_stats` answers four metrics
   * and only `test` charts its counters: `misplaced` and `skipped` are gaps in
   * the tests ratio and say nothing about the files ratio, so offering them
   * under `test_files` would invite a reading of the chart that is not true.
   */
  readonly gaps?: readonly string[];
}

export const PARITY_METRICS: readonly ParityMetric[] = Object.freeze([
  { key: "api", label: "api:compare", model: ApiCompareStat, gaps: ["misplaced", "missing"] },
  {
    key: "api_privates",
    label: "api:compare --privates",
    model: ApiComparePrivatesStat,
    gaps: ["missing"],
  },
  {
    key: "test",
    label: "test:compare",
    model: TestCompareStat,
    gaps: ["misplaced", "skipped", "assertion_count_mismatch", "assertion_kind_mismatch"],
  },
  {
    key: "test_files",
    label: "test:compare files",
    model: TestCompareStat,
    num: "files_mapped",
    den: "files_total",
  },
  {
    key: "test_assert_count",
    label: "test:compare assertion counts",
    model: TestCompareStat,
    num: "matched",
    den: "matched",
    sub: "assertion_count_mismatch",
  },
  {
    key: "test_assert_kind",
    label: "test:compare assertion kinds",
    model: TestCompareStat,
    num: "matched",
    den: "matched",
    sub: "assertion_kind_mismatch",
  },
  { key: "calls", label: "api:compare --calls", model: ApiCallsStat, gaps: ["mismatched"] },
  { key: "call_args", label: "calls:args", model: ApiCallArgsStat, gaps: ["mismatched"] },
]);

export function lookupParityMetric(key: string): ParityMetric | undefined {
  return PARITY_METRICS.find((metric) => metric.key === key);
}

export function numeratorColumn(metric: ParityMetric): string {
  return metric.num ?? "matched";
}

export function denominatorColumn(metric: ParityMetric): string {
  return metric.den ?? "total";
}

/**
 * Whether this metric is its run's own headline number.
 *
 * If it is, the `percent` column CI wrote is authoritative and gets read
 * rather than recomputed. A derived metric has no percent column of its own.
 */
export function isNativeMetric(metric: ParityMetric): boolean {
  return (
    numeratorColumn(metric) === "matched" &&
    denominatorColumn(metric) === "total" &&
    metric.sub === undefined
  );
}

/** Every column this metric reads, so a database missing one can decline it. */
export function metricColumns(metric: ParityMetric): string[] {
  const columns = [numeratorColumn(metric), denominatorColumn(metric)];
  if (metric.sub !== undefined) columns.push(metric.sub);
  if (isNativeMetric(metric)) columns.push("percent");
  return [...new Set(columns)];
}

/**
 * Whether the connected database has every column this metric reads.
 *
 * The stats schema is the sync cron's, so trailmap can be deployed against one
 * that predates a run. Offering a metric whose column is not there would fail
 * the query and take the whole page down, so the picker only offers what can
 * be charted. ringo asks `pragma_table_info`; this asks the model.
 */
/**
 * This metric's gap columns, narrowed to the ones the database has.
 *
 * `null` rather than `[]` for a metric with no gaps, because that is what
 * ringo's JSON says — Go marshals its nil slice as null — and the drawing code
 * reading this JSON is ringo's own, vendored. Matching the shape exactly is
 * what lets scripts/gate-ringo-parity.ts diff the two endpoints directly
 * instead of normalising first.
 */
export function gapsFor(metric: ParityMetric): string[] | null {
  if (metric.gaps === undefined || metric.gaps.length === 0) return null;
  const present = metric.model.presentColumns(metric.gaps);
  return present.length > 0 ? present : null;
}

export function metricAvailable(metric: ParityMetric): boolean {
  // Synchronous, and that is safe only because reflection is already warm:
  // `loadStatsSchemas()` awaits it once from
  // config/initializers/stats-database.ts. Without that warm-up this answers
  // false for every metric and the page comes up empty — see the note there.
  const columns = metric.model.columnNames();
  if (columns.length === 0) return false;
  return metricColumns(metric).every((column) => columns.includes(column));
}
