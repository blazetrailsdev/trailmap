/**
 * Parse the two advisory call summaries the `--calls` run prints at the end of
 * its output (compare.ts, grand-total block):
 *
 *   Calls (advisory): 6213 matched pairs checked, 1494 omit a ported-method call Rails makes
 *   Call args (advisory): 812 call sites compared, 96 pass different arguments
 *
 * Both are whole-repo totals — compare.ts tallies them across packages and
 * prints them once — so each yields a single row rather than one per package.
 * `matched` is derived (compared - mismatched) so the rows carry the same
 * matched/total/percent shape as every other stats table, and the parity page
 * can chart them without a special case.
 *
 * Before the step was renamed from --wide-calls, both lines carried a ", WIDE"
 * qualifier ("Calls (advisory, WIDE): ..."). It is the same measurement over the
 * same full surface — the numbers run continuously across the rename — so the
 * qualifier is simply optional here, and ~850 pre-rename logs parse.
 *
 * Returns null for a summary the log doesn't carry: `Call args` only prints
 * when the call-arg artifact exists, so an older log has calls but no args.
 */
export function parseCallSummariesFromLogs(logs: string): {
  calls: CallSummary | null;
  callArgs: CallSummary | null;
} {
  return {
    calls: matchCallSummary(
      logs,
      /Calls \(advisory(?:, WIDE)?\): (\d+) matched pairs checked, (\d+) omit a ported-method call/,
    ),
    callArgs: matchCallSummary(
      logs,
      /Call args \(advisory(?:, WIDE)?\): (\d+) call sites compared, (\d+) pass different arguments/,
    ),
  };
}

export interface CallSummary {
  matched: number;
  total: number;
  percent: number;
  mismatched: number;
}

function matchCallSummary(logs: string, re: RegExp): CallSummary | null {
  const m = re.exec(logs);
  if (!m) return null;
  const total = parseInt(m[1]);
  const mismatched = parseInt(m[2]);
  if (total <= 0) return null;
  const matched = total - mismatched;
  return {
    matched,
    total,
    percent: Math.round((matched / total) * 1000) / 10,
    mismatched,
  };
}
