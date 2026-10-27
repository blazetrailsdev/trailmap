import type { ParityDay } from "../models/parity-day.ts";

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
 * Group projected rows into one series per package.
 *
 * A PURE MAPPING, with no arithmetic left in it. The rows arrive already
 * measured: `matched`, `total` and `percent` are the metric's numbers, worked
 * out by `measureRow` when the projection was built (app/models/parity-day.ts).
 *
 * That measurement used to happen here, on raw comparison rows on their way
 * out. It moved because the rows now come from `parity_days`, where it has
 * already been applied — and applying it twice is not a no-op: the assertion
 * metrics use `matched` as their DENOMINATOR, so a second pass divides a
 * number by itself and reports 100%.
 *
 * The package ORDER is load-bearing rather than cosmetic: the page assigns a
 * colour per package from its position in the list it asked for, so a series
 * order that followed the rows would repaint the chart whenever a filter
 * changed. Hence the caller's `packages`, not the rows' own order.
 *
 * The shape is a cross-repo contract — the code consuming it is ringo's,
 * vendored verbatim (vendor/ringo/parity-draw.js), and
 * scripts/gate-ringo-parity.ts diffs this output against ringo's own endpoint
 * point for point.
 */
export function serializeParitySeries(
  rows: ParityDay[],
  metricKey: string,
  packages: string[],
): ParitySeries[] {
  const byPackage = new Map<string, ParityPoint[]>();

  for (const row of rows) {
    const point: ParityPoint = {
      date: String(row.day),
      pr: Number(row.pr_number ?? 0),
      percent: Number(row.percent ?? 0),
      matched: Number(row.matched ?? 0),
      total: Number(row.total ?? 0),
    };
    // Omitted rather than empty when the run has no counters, which is what
    // ringo's JSON does for the derived metrics.
    if (row.gaps != null && Object.keys(row.gaps).length > 0) point.gaps = row.gaps;

    const points = byPackage.get(row.package);
    if (points) points.push(point);
    else byPackage.set(row.package, [point]);
  }

  return packages
    .filter((pkg) => byPackage.has(pkg))
    .map((pkg) => ({ metric: metricKey, package: pkg, points: byPackage.get(pkg)! }));
}
