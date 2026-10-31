import { Stats } from "./stats.ts";

/**
 * A merged trails PR, as the stats cron recorded it.
 *
 * Only two of its columns matter to the parity page, and they are the reason
 * this model exists at all: the comparison tables carry no timestamp, so the
 * time axis of every chart comes from `merged_at` here.
 *
 * `number` is the primary key, not `id` — the cron keys on the GitHub PR
 * number and the table has no `id` column. `primaryKey` says so; without it
 * trails looks for `id` and every lookup fails on a column that is not there.
 *
 * The comparison tables are joined on `merge_commit_sha`, not on
 * `pr_number`, even though both columns exist and `pr_number` is the obvious
 * one. Each comparison table's only index is `UNIQUE (merge_commit_sha,
 * package)` and there is NO index on `pr_number`, so joining on the sha is the
 * one direction that can use an index. We do not own this schema and cannot
 * add one.
 *
 * @trails-typegen no-schema
 */
export class PullRequest extends Stats {
  static {
    this.primaryKey = "number";
  }

  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare number: number;
  declare title: string | null;
  declare author: string | null;
  declare branch: string | null;
  declare merge_commit_sha: string | null;
  /** ISO 8601, or null/"" for a PR that was closed without merging. */
  declare merged_at: string | null;
}
