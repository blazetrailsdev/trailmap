import { Hub } from "./hub.js";
import {
  PARITY_METRICS,
  denominatorColumn,
  gapsFor,
  isNativeMetric,
  metricColumns,
  numeratorColumn,
  type ParityMetric,
} from "./parity-metric.js";
import type { Relation } from "@blazetrails/activerecord";

/** How many rows go into one `upsertAll` statement. */
const BATCH = 500;

/**
 * Where one package stood under one comparison run, at the end of one day.
 *
 * A PROJECTION of the stats database, not a source of truth — see the
 * migration. `/graphs/parity` reads this; `refreshFromStats()` fills it from
 * the 7 GB SQLite file when that file is readable.
 *
 * On `Hub`, so it lives in Postgres beside the owner/repository hierarchy. The
 * comparison tables it derives from are on `Stats`, a third connection on a
 * second SQLite driver (app/models/stats.ts). Nothing joins across them and
 * nothing needs to: the refresh reads one and writes the other, in that order,
 * in TypeScript.
 *
 * **The rows here are already MEASURED.** `matched`, `total` and `percent` are
 * the metric's numbers, not the table's columns — for the assertion metrics
 * the denominator is `matched` and the mismatching ones have come off the
 * numerator. That is why `measureRow` lives here and the serializer no longer
 * does arithmetic: the measurement is part of producing the rollup, and doing
 * it again on the way out would subtract twice.
 */
export class ParityDay extends Hub {
  static _tableName = "parity_days";

  declare id: number;
  declare metric: string;
  declare package: string;
  /** A real `date`; the stats database only has a text timestamp to slice. */
  declare day: string;
  declare pr_number: number;
  declare matched: number;
  declare total: number;
  declare percent: number;
  /** The run's own counters, which vary by metric. `null` for the derived ones. */
  declare gaps: Record<string, number> | null;

  /**
   * The rows `/graphs/parity` draws, for one run.
   *
   * Ordered by day because a chart line is read in order. The page's colour
   * assignment depends on the package order the CALLER asked for, not on this,
   * which is why the ordering here is by day alone.
   */
  static forChart(metricKey: string, packages: string[], since?: string): Relation<ParityDay> {
    let rel = ParityDay.where({ metric: metricKey, package: packages }).order({ day: "asc" });
    if (since) rel = rel.where("day >= ?", since);
    return rel as Relation<ParityDay>;
  }

  /** The most recent day any run has a row for, or null when the table is empty. */
  static async latestDay(): Promise<string | null> {
    const max = await ParityDay.maximum("day");
    return max == null ? null : String(max);
  }

  /**
   * Rebuild the projection from the stats database.
   *
   * Reads through `CompareRun.dailyRollup` — the window-function Relation that
   * already produces one row per (package, day) — and writes with `upsertAll`
   * on the `(metric, package, day)` unique index, so a re-run corrects rows
   * rather than duplicating them. Upsert rather than insert-what-is-missing
   * because a day's last merged PR changes when a later PR lands that day.
   *
   * The caller is responsible for holding the refresh lock; see the controller.
   */
  static async refreshFromStats(): Promise<{ metrics: number; rows: number }> {
    let rows = 0;
    let metrics = 0;

    for (const metric of PARITY_METRICS) {
      const model = metric.model;
      const packages = (await model.distinct().pluck("package")).filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      );
      if (packages.length === 0) continue;

      const gaps = gapsFor(metric) ?? [];
      const rolled = await model
        .dailyRollup({ packages, columns: [...metricColumns(metric), ...gaps] })
        .toArray();
      if (rolled.length === 0) continue;

      const records = rolled.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const { matched, total, percent } = measureRow(record, metric);
        return {
          metric: metric.key,
          package: String(record.package),
          day: String(record.day),
          pr_number: Number(record.pr_number ?? 0),
          matched,
          total,
          percent,
          gaps:
            gaps.length > 0
              ? Object.fromEntries(gaps.map((gap) => [gap, Number(record[gap] ?? 0)]))
              : null,
        };
      });

      for (let i = 0; i < records.length; i += BATCH) {
        await ParityDay.upsertAll(records.slice(i, i + BATCH), {
          uniqueBy: ["metric", "package", "day"],
        });
      }
      metrics += 1;
      rows += records.length;
    }

    return { metrics, rows };
  }
}

/**
 * One rollup row's numerator, denominator and percent under one metric.
 *
 * The ONLY copy of this arithmetic. It used to live in
 * `app/serializers/parity-json.ts`, which applied it to raw comparison rows on
 * their way out to the page; now the projection applies it on the way in and
 * the serializer is a pure mapping. Two copies would be two readings that have
 * to agree, and for the assertion metrics — whose denominator is `matched` —
 * applying it twice silently reports 100%.
 *
 * A NATIVE metric's percent is the column CI wrote, read rather than
 * recomputed, so trailmap and CI cannot disagree in the last decimal. A derived
 * metric has no such column and is computed to one decimal, which is the
 * precision CI writes, so both kinds read alike.
 */
export function measureRow(
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
  return {
    matched,
    total: den,
    percent: den > 0 ? Math.round((1000 * matched) / den) / 10 : 0,
  };
}
