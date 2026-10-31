import { Stats } from "./stats.ts";
import type { Relation } from "@blazetrails/activerecord";

/**
 * One package's result from one comparison run on one merged trails PR.
 *
 * Five tables in the stats database have this shape — `api:compare`,
 * `api:compare --privates`, `test:compare` and the two advisory call checks —
 * because they are all written by the same cron out of the same CI job logs.
 * So they are five subclasses of one abstract class rather than five unrelated
 * models, and everything that is the same about them (the columns, the day-end
 * rollup, the percent) is here exactly once.
 *
 * Not STI: there is no type column and no shared table. This is Rails'
 * abstract-class inheritance — `CompareRun` has no table of its own, each
 * subclass names one, and `Stats` above it carries the connection.
 *
 * ringo computes all of this with a table-driven struct (`parityMetric` in
 * webhook/parity.go) that hand-writes each table's column list and probes
 * `pragma_table_info` before every query to find out which columns exist,
 * because it has no model layer and does not own the schema. Here the column
 * list IS the schema reflection: `hasAttribute` answers it, so
 * `metricAvailable`, `availableGaps` and `tableColumns` have no counterpart.
 */
export class CompareRun extends Stats {
  static {
    // Not `abstract class`, deliberately. The abstractness here is
    // ActiveRecord's — no table of its own — and this flag is what
    // expresses it. TypeScript's `abstract` additionally makes the
    // constructor type abstract, which AR's statics cannot accept:
    // every one of them is typed `this: typeof Base`. `Hub` and
    // `Stats` are spelled this way for the same reason.
    this.abstractClass = true;
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  /** The merge commit this run measured; the join key to `pull_requests`. */
  declare merge_commit_sha: string;
  declare pr_number: number;
  /** A `@blazetrails/*` package name, or the synthetic `all` on the call tables. */
  declare package: string;
  declare matched: number;
  declare total: number;
  /** What CI wrote, to one decimal. Authoritative for a native metric. */
  declare percent: number;

  /**
   * Which of these columns this table actually has.
   *
   * The stats schema belongs to the sync cron in another repository, so
   * trailmap can be deployed against a database that predates a counter.
   * Selecting a column that is not there would fail the whole query and take a
   * working chart down with it, so an unknown column is simply not offered —
   * ringo's rule, by way of AR's reflection instead of its own PRAGMA probe.
   *
   * Which columns are WORTH asking for is the metric's business, not the
   * table's: see `gapsFor` in app/models/parity-metric.ts.
   */
  static presentColumns(this: typeof CompareRun, wanted: readonly string[]): string[] {
    const columns = this.columnNames();
    return wanted.filter((column) => columns.includes(column));
  }

  /**
   * Where each package stood at the end of each day: the numbers from the last
   * PR merged that day, oldest day first.
   *
   * ringo spells this as a `GROUP BY day, package` with a single `MAX(merged_at)`
   * and the rest of the columns bare, leaning on SQLite's documented
   * bare-column rule to get the row that produced the max. That is correct on
   * SQLite and only on SQLite. This uses a window function instead —
   * `ROW_NUMBER() OVER (PARTITION BY day, package ORDER BY merged_at DESC)` —
   * which says the same thing in standard SQL, so the rollup keeps working if
   * this database is ever not SQLite, and says what it means besides.
   *
   * Joined on `merge_commit_sha`, NOT `pr_number`: see app/models/pull-request.ts
   * — the sha is the leading column of each table's only index and `pr_number`
   * has none.
   *
   * The subquery is a raw string because that is what `from` takes: Rails
   * applies an alias of its own only to a Relation (`query_methods.rb:1783`),
   * and a string is passed through verbatim, alias included. The result is
   * still an ordinary Relation, so a caller composes `where` and `order` onto
   * it as usual.
   *
   * A day with no merged PR has no row, so a line spans the gap rather than
   * dropping to zero.
   */
  static dailyRollup(
    this: typeof CompareRun,
    { packages, since, columns }: { packages: string[]; since?: string; columns: string[] },
  ): Relation<CompareRun> {
    // `columns` is what the METRIC reads — its numerator, denominator and
    // subtrahend, plus its gap counters — not a fixed list, because four of the
    // eight metrics read this table and they do not read the same columns.
    //
    // The only interpolation is the table name and those column names, and
    // neither comes from a request: a column reaches here only after
    // `presentColumns` has matched it against the reflected schema. The date
    // window is BOUND, on the outer relation — `day` is `merged_at`'s first ten
    // characters, so bounding the day is the same set of rows as bounding the
    // timestamp, and it keeps the one request-supplied value out of the SQL.
    const table = this.tableName!;
    const selected = this.presentColumns([...new Set(columns)]);
    const inner = [
      `SELECT substr(p.merged_at, 1, 10) AS day,`,
      `       s.package, s.pr_number`,
      ...selected.map((column) => `     , s.${column}`),
      `     , ROW_NUMBER() OVER (PARTITION BY substr(p.merged_at, 1, 10), s.package`,
      `                          ORDER BY p.merged_at DESC, s.pr_number DESC) AS rn`,
      `  FROM pull_requests p`,
      `  JOIN ${table} s ON s.merge_commit_sha = p.merge_commit_sha`,
      ` WHERE p.merged_at IS NOT NULL AND p.merged_at != ''`,
    ].join("\n");

    let rollup = this.from(`(\n${inner}\n) ${table}`, table)
      .select("day", "package", "pr_number", ...selected)
      .where({ rn: 1, package: packages })
      .order({ day: "asc" });
    if (since) rollup = rollup.where("day >= ?", since);
    return rollup;
  }
}
