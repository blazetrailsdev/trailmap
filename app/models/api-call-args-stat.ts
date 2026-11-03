import { CompareRun } from "./compare-run.ts";

/**
 * `calls:args` — the second advisory call check, same synthetic `all` package.
 *
 * @trails-typegen no-schema
 */
export class ApiCallArgsStat extends CompareRun {
  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare mismatched: number;
}
