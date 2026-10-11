import type { CompareRun } from "../models/compare-run.js";
import {
  type ParityMetric,
  denominatorColumn,
  isNativeMetric,
  numeratorColumn,
} from "../models/parity-metric.js";

/** One package's standing at the end of one day, as the chart reads it. */
export interface ParityPoint {
  date: string;
  pr: number;
  percent: number;
  matched: number;
  total: number;
  gaps?: Record<string, number>;
}

/** One line: one package's standing under one metric. */
export interface ParitySeries {
  metric: string;
  package: string;
  points: ParityPoint[];
}

/**
 * A rollup row's numerator, denominator and percent under one metric.
 *
 * `matched` and `total` are the metric's columns, not the table's: for the
 * assertion metrics the denominator is `matched` and the mismatching ones come
 * off the numerator, so a row's "matched" here is smaller than its `matched`
 * column.
 *
 * The percent of a NATIVE metric is the `percent` column CI wrote, read rather
 * than recomputed — it is the authoritative number and recomputing it would
 * let trailmap and CI disagree in the last decimal. A derived metric has no
 * such column, so it is computed and rounded to one decimal, which is the
 * precision CI writes, so both kinds of line read at the same precision.
 */
function measure(
  row: Record<string, unknown>,
  metric: ParityMetric,
): { matched: number; total: number; percent: number } {
  const num = Number(row[numeratorColumn(metric)] ?? 0);
  const den = Number(row[denominatorColumn(metric)] ?? 0);
  const sub = metric.sub === undefined ? 0 : Number(row[metric.sub] ?? 0);
  const matched = num - sub;
  if (isNativeMetric(metric)) {
    return { matched, total: den, percent: Number(row.percent ?? 0) };
  }
  // `Math.round(1000 * x) / 10` rather than toFixed: one decimal, as a number.
  const percent = den > 0 ? Math.round((1000 * matched) / den) / 10 : 0;
  return { matched, total: den, percent };
}

/**
 * Group rollup rows into one series per package, in the order the caller asked
 * for the packages.
 *
 * The order is load-bearing and not cosmetic: the page assigns a colour per
 * package from its position in this list, so a series order that depended on
 * which packages happened to have rows would repaint the chart whenever a
 * filter changed.
 */
export function serializeParitySeries(
  rows: CompareRun[],
  metric: ParityMetric,
  packages: string[],
  gaps: string[],
): ParitySeries[] {
  const byPackage = new Map<string, ParityPoint[]>();
  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    const { matched, total, percent } = measure(record, metric);
    const point: ParityPoint = {
      date: String(record.day),
      pr: Number(record.pr_number ?? 0),
      percent,
      matched,
      total,
    };
    if (gaps.length > 0) {
      point.gaps = Object.fromEntries(gaps.map((gap) => [gap, Number(record[gap] ?? 0)]));
    }
    const points = byPackage.get(row.package);
    if (points) points.push(point);
    else byPackage.set(row.package, [point]);
  }

  return packages
    .filter((pkg) => byPackage.has(pkg))
    .map((pkg) => ({ metric: metric.key, package: pkg, points: byPackage.get(pkg)! }));
}
