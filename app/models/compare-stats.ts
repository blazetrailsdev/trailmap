import { CompareRun } from "./compare-run.ts";

/**
 * The five comparison tables, one subclass each.
 *
 * Every column they share is on `CompareRun`; what is declared here is what
 * that table has and the others do not. Which of them the page's "gaps" chart
 * offers is NOT decided here — it belongs to the metric
 * (app/models/parity-metric.ts), because four of the eight metrics read
 * `test_compare_stats` and only one of them charts its counters.
 */

/** `api:compare` — the public API surface against Rails'. */
export class ApiCompareStat extends CompareRun {
  declare misplaced: number;
  declare missing: number;
}

/** `api:compare --privates` — the same, for Rails' private surface. */
export class ApiComparePrivatesStat extends CompareRun {
  declare missing: number;
}

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
 */
export class TestCompareStat extends CompareRun {
  declare misplaced: number;
  declare skipped: number;
  declare files_mapped: number;
  declare files_total: number;
  declare assertion_count_mismatch: number;
  declare assertion_kind_mismatch: number;
}

/**
 * `api:compare --calls` — the advisory call check.
 *
 * `compare.ts` tallies this across packages and prints one grand total, so the
 * table holds a single synthetic package, `all`. The page shows one chip and
 * the chart one line; nothing here special-cases it, which is why
 * `/graphs/parity?packages=activerecord&metrics=calls` has to drop the
 * package rather than fail (see the controller).
 */
export class ApiCallsStat extends CompareRun {
  declare mismatched: number;
}

/** `calls:args` — the second advisory call check, same synthetic `all` package. */
export class ApiCallArgsStat extends CompareRun {
  declare mismatched: number;
}
