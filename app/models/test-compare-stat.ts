import { CompareRun } from "./compare-run.ts";

/**
 * `test:compare` — ported tests against Rails' own.
 *
 * Four of the page's eight metrics read this one table: the headline tests
 * percent, the files ratio, and the two assertion ratios. See
 * app/models/parity-metric.ts — a metric is a (model, numerator, denominator)
 * triple, not a table.
 *
 * `assertion_count_mismatch` and `assertion_kind_mismatch` are gaps rather
 * than metrics here because they are advisory counters on tests that ARE
 * mapped: the tests percent does not move when one of them does.
 *
 * @trails-typegen no-schema
 */
export class TestCompareStat extends CompareRun {
  // The stats-sync cron owns this schema, so trails-tsc has none to read.
  // Story: trails-tsc-type-models-on-unowned-schema.
  declare misplaced: number;
  declare skipped: number;
  declare files_mapped: number;
  declare files_total: number;
  declare assertion_count_mismatch: number;
  declare assertion_kind_mismatch: number;
}
