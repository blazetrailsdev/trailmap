import { Migration } from "@blazetrails/activerecord";

/**
 * Where each package stood under each comparison run, at the end of each day.
 *
 * A PROJECTION, not a source of truth. The source is the stats database the
 * nightly stats-sync cron fills — a 7 GB SQLite file on the host — and this
 * table is the ~7k-row rollup of it that `/graphs/parity` actually reads:
 * 180,999 raw rows across five tables collapse to one row per (metric,
 * package, day), a 26× shrink. Everything here can be rebuilt from the stats
 * database by `ParityDay.refreshFromStats()`, so a lost row is a refresh away
 * rather than a loss.
 *
 * The rollup used to run per request, as a window function over that SQLite
 * file: ~930 ms for a three-metric page load, and it only worked where the
 * file was mounted.
 *
 * `day` is a real DATE here, where the stats database only has
 * `substr(merged_at, 1, 10)` over a text timestamp.
 */
export class CreateParityDays extends Migration.get(8) {
  async change() {
    await this.createTable("parity_days", (t) => {
      // The comparison run: one of the eight keys in app/models/parity-metric.ts.
      //
      // A plain string, with NO database-level constraint on the value —
      // neither a native PG enum nor a check listing the keys. Both were
      // considered. The set is closed today, but it is closed by what trails'
      // CI runs, not by anything this database knows, so pinning it here puts
      // a migration in the path of adding a comparison run. The only writer is
      // `ParityDay.refreshFromStats()`, which iterates `PARITY_METRICS`, so the
      // constraint would be guarding against a typo that cannot occur.
      t.string("metric", { null: false });
      // A `@blazetrails/*` package, or the synthetic `all` the two call runs use.
      t.string("package", { null: false });
      t.date("day", { null: false });
      // The PR the numbers came from — the last one merged that day.
      t.integer("pr_number", { null: false });
      t.integer("matched", { null: false });
      t.integer("total", { null: false });
      // One decimal, which is the precision CI writes.
      t.decimal("percent", { precision: 5, scale: 2, null: false });
      // The run's extra counters, which GENUINELY vary by metric: `api` writes
      // misplaced and missing, `test` writes four, and the three derived
      // metrics write none. The alternative is six mostly-null integer columns
      // whose meaning depends on a sibling column.
      t.column("gaps", "jsonb");
      t.timestamps();

      // The identity of a row, and the conflict target `upsertAll` needs: one
      // standing per run, per package, per day.
      t.index(["metric", "package", "day"], {
        name: "index_parity_days_on_metric_and_package_and_day",
        unique: true,
      });
      // The page's own query: a window of days for a few packages under one run.
      t.index(["metric", "day"], { name: "index_parity_days_on_metric_and_day" });
    });

    // Ratios the source cannot produce. These are cheap and they are the shape
    // of the data rather than a policy: a run cannot match more than it
    // compared, and a percent outside 0..100 is a parse error upstream, not a
    // measurement.
    await this.addCheckConstraint("parity_days", "matched <= total", {
      name: "parity_days_matched_within_total",
    });
    await this.addCheckConstraint("parity_days", "percent >= 0 AND percent <= 100", {
      name: "parity_days_percent_is_a_percentage",
    });
    await this.addCheckConstraint("parity_days", "total >= 0 AND matched >= 0", {
      name: "parity_days_counts_are_not_negative",
    });
  }
}
