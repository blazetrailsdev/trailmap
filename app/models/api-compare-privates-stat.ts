import { CompareRun } from "./compare-run.ts";

/**
 * `api:compare --privates` — the same, for Rails' private surface.
 *
 * @trails-typegen no-schema
 */
export class ApiComparePrivatesStat extends CompareRun {
  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare missing: number;
}
