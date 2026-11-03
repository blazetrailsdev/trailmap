import { CompareRun } from "./compare-run.ts";

/**
 * `api:compare --calls` — the advisory call check.
 *
 * `compare.ts` tallies this across packages and prints one grand total, so the
 * table holds a single synthetic package, `all`. The page shows one chip and
 * the chart one line; nothing here special-cases it, which is why
 * `/graphs/parity?packages=activerecord&metrics=calls` has to drop the
 * package rather than fail (see the controller).
 *
 * @trails-typegen no-schema
 */
export class ApiCallsStat extends CompareRun {
  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare mismatched: number;
}
