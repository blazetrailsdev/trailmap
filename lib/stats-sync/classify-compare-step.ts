/**
 * Map a CI step's `##[group]Run <command>` line to the compare step it is, or
 * null for a step the stats sync doesn't parse.
 *
 * Pulled out of extractStepLogs and covered by tests because getting it wrong
 * is silent: two runs of `compare.ts` that classify the same overwrite each
 * other in the step map (the later one in the job wins) and the losing step's
 * stats table quietly fills with the wrong run's numbers.
 *
 * Historic flags and entry-point names are kept — the sync reparses job logs
 * going back to the start of the repo, so a rename must stay understood here
 * forever, not just until the next backfill.
 */
export function classifyCompareStep(command: string): string | null {
  if (command.includes("api-compare/compare.ts")) {
    if (command.includes("--privates")) return "api_compare_privates";
    // `--wide-calls` is the pre-rename flag for the same run (CI step "API
    // comparison (wide calls)"). Must be checked before falling through to
    // api_compare: the calls run prints the same per-package table and appears
    // later in the job, so misclassifying it overwrites the public-API step.
    if (command.includes("--calls") || command.includes("--wide-calls")) return "api_calls";
    return "api_compare";
  }
  if (
    command.includes("test-compare/compare.ts") ||
    // Pre-RFC-0092 entry-point names, kept so historic logs still parse.
    command.includes("test-compare/test-compare.ts") ||
    command.includes("test-compare/convention-compare.ts") ||
    /\bbg-gates\.mjs wait(?: \S+)* test-compare(?: |$)/.test(command)
  ) {
    return "test_compare";
  }
  return null;
}
