import { Hub } from "./hub.ts";
import {
  PARITY_METRICS,
  denominatorColumn,
  gapsFor,
  isNativeMetric,
  metricColumns,
  numeratorColumn,
  type ParityMetric,
} from "./parity-metric.ts";
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

  // A `jsonb` column is `unknown` to trails-tsc. The run's own counters, which
  // vary by metric; `null` for the derived ones.
  // Story: trails-tsc-type-custom-attribute-casts.
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
   * already produces one row per (package, day) — and replaces that metric's
   * rows with what it produced, inside ONE TRANSACTION per metric.
   *
   * Replace rather than upsert-only, and that is the difference between this
   * being a rebuild and merely an update. `dailyRollup` is asked for every day
   * with no `since`, so what it returns IS the complete answer for that
   * metric; anything else under that metric is an orphan — a package that
   * stopped being compared, or a day whose rows moved when a PR's merge commit
   * was reassigned. An upsert leaves those behind forever, including under
   * `--force`, so "everything here can be rebuilt" would have been false.
   *
   * Per metric and in a transaction so a reader never sees a half-replaced
   * run: Postgres holds the old rows visible until the swap commits, and a
   * failure part-way leaves that metric exactly as it was rather than mixing
   * two rollups.
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

      await ParityDay.transaction(async () => {
        await ParityDay.where({ metric: metric.key }).deleteAll();
        // In batches even inside the swap: 2,380 rows for the biggest run
        // today, but one statement carrying every row is a parameter count
        // nobody should rely on staying under the limit.
        for (let i = 0; i < records.length; i += BATCH) {
          await ParityDay.insertAll(records.slice(i, i + BATCH));
        }
      });
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
