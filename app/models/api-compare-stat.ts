import { CompareRun } from "./compare-run.ts";

/**
 * `api:compare` — the public API surface against Rails'.
 *
 * @trails-typegen no-schema
 */
export class ApiCompareStat extends CompareRun {
  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare misplaced: number;
  declare missing: number;
}
