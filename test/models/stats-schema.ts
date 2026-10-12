import { Stats } from "../../app/models/stats.js";
import { loadStatsSchemas } from "../../app/models/index.js";

/**
 * A scratch stats database, on the same adapter production uses.
 *
 * trailmap does NOT own this schema — the nightly stats-sync cron in another
 * repository does — so there are no migrations to replay the way
 * `migrateScratchDatabase` replays `db/migrate`. What is written here is the
 * shape the real database has, taken from it column for column; the gate
 * (scripts/gate-ringo-parity.ts) is what checks that claim against the live
 * file, and this is what lets the rollup be tested without one.
 *
 * `node-sqlite` rather than `sqlite3`, because that is the adapter the stats
 * connection runs on and the point of these tests is the query it executes.
 * Not `readonly`, because a fixture has to be written before it can be read.
 *
 * `database` is a FILE for the parity gate's fixture mode, which has ringo's Go
 * read the same rows from another process; the tests keep `:memory:`.
 */
export async function createScratchStatsDatabase(database = ":memory:"): Promise<void> {
  await Stats.establishConnection({
    adapter: "node-sqlite",
    database,
    pool: 1,
  });

  const pool = Stats.connectionPool();
  const adapter = await pool.leaseConnection();
  await adapter.execute(`
    CREATE TABLE pull_requests (
      number INTEGER PRIMARY KEY, title VARCHAR(255), author VARCHAR(255),
      branch VARCHAR(255), merge_commit_sha VARCHAR(255), merged_at VARCHAR(255)
    )`);
  await adapter.execute(`
    CREATE TABLE api_compare_stats (
      id INTEGER PRIMARY KEY, merge_commit_sha VARCHAR(255), pr_number INTEGER,
      package VARCHAR(255), matched INTEGER, total INTEGER, percent REAL,
      misplaced INTEGER, missing INTEGER
    )`);
  await adapter.execute(`
    CREATE TABLE api_compare_privates_stats (
      id INTEGER PRIMARY KEY, merge_commit_sha VARCHAR(255), pr_number INTEGER,
      package VARCHAR(255), matched INTEGER, total INTEGER, percent REAL, missing INTEGER
    )`);
  await adapter.execute(`
    CREATE TABLE test_compare_stats (
      id INTEGER PRIMARY KEY, merge_commit_sha VARCHAR(255), pr_number INTEGER,
      package VARCHAR(255), matched INTEGER, total INTEGER, percent REAL,
      skipped INTEGER, files_mapped INTEGER, files_total INTEGER, misplaced INTEGER,
      assertion_count_mismatch INTEGER, assertion_kind_mismatch INTEGER
    )`);
  for (const table of ["api_calls_stats", "api_call_args_stats"]) {
    await adapter.execute(`
      CREATE TABLE ${table} (
        id INTEGER PRIMARY KEY, merge_commit_sha varchar, pr_number INTEGER,
        package varchar, matched INTEGER, total INTEGER, percent float, mismatched INTEGER
      )`);
  }

  await loadStatsSchemas();
}

/** One merged PR and one `api_compare_stats` row for it. */
export async function seedApiCompare(
  rows: {
    pr: number;
    mergedAt: string;
    package: string;
    matched: number;
    total: number;
    percent: number;
    misplaced?: number;
    missing?: number;
  }[],
): Promise<void> {
  const adapter = await Stats.connectionPool().leaseConnection();
  const seen = new Set<number>();
  for (const row of rows) {
    const sha = `sha${row.pr}`;
    if (!seen.has(row.pr)) {
      seen.add(row.pr);
      await adapter.execute(
        `INSERT INTO pull_requests (number, merge_commit_sha, merged_at)
         VALUES (${row.pr}, '${sha}', '${row.mergedAt}')`,
      );
    }
    await adapter.execute(
      `INSERT INTO api_compare_stats
         (merge_commit_sha, pr_number, package, matched, total, percent, misplaced, missing)
       VALUES ('${sha}', ${row.pr}, '${row.package}', ${row.matched}, ${row.total},
               ${row.percent}, ${row.misplaced ?? 0}, ${row.missing ?? 0})`,
    );
  }
}
