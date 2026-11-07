import { Stats } from "../../app/models/stats.ts";
import { Dir, getPath } from "@blazetrails/ruby-compat";
import { Migration } from "@blazetrails/activerecord";
import { STATS_SYNC_MIGRATIONS_PATH } from "../../config/database.ts";
import { loadStatsSchemas } from "../../lib/model-schemas.ts";

/**
 * A scratch stats database, on the same adapter production uses.
 *
 * The tables come from replaying `db/stats-sync-migrate` on this connection,
 * the schema StatsSyncJob writes, so a column added there reaches the tests
 * with no edit here.
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

  const adapter = await Stats.connectionPool().leaseConnection();
  for (const file of Dir.glob(`${getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)}/[0-9]*_*.ts`).sort()) {
    for (const exported of Object.values(await import(file))) {
      if (typeof exported === "function" && exported.prototype instanceof Migration) {
        await new (exported as new () => Migration)().execMigration(adapter, "up");
      }
    }
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
