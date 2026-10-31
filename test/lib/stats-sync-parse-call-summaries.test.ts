import { describe, expect, it } from "vitest";
import { parseCallSummariesFromLogs } from "../../lib/stats-sync/parse-call-summaries.ts";

// The tail of a `compare.ts --calls` run: the grand-total block, where both
// advisory summaries are printed once for the whole repo.
const callsLog = `
  Overall: 12345/12345 methods (100%)  |  files: 500/500
  Option keys (advisory): 112 pairs compared, 17 with keys missing in TS (likely-real), 72 differ total — see output/options-key-mismatches.json
  Calls (advisory): 6213 matched pairs checked, 1494 omit a ported-method call Rails makes — see output/call-mismatches.json
  Call args (advisory): 812 call sites compared, 96 pass different arguments — see output/call-arg-mismatches.json
`;

// Every log stored before the call-arg artifact existed: calls, no call args.
const callsOnlyLog = `
  Calls (advisory): 6213 matched pairs checked, 1494 omit a ported-method call Rails makes — see output/call-mismatches.json
`;

describe("parseCallSummariesFromLogs", () => {
  it("derives matched/total/percent from both advisory summaries", () => {
    const { calls, callArgs } = parseCallSummariesFromLogs(callsLog);

    expect(calls).toEqual({ matched: 4719, total: 6213, percent: 76, mismatched: 1494 });
    expect(callArgs).toEqual({ matched: 716, total: 812, percent: 88.2, mismatched: 96 });
  });

  it("returns null for a summary the log does not carry", () => {
    const { calls, callArgs } = parseCallSummariesFromLogs(callsOnlyLog);

    expect(calls?.total).toBe(6213);
    expect(callArgs).toBeNull();
  });

  // Pre-rename logs label the same measurement "advisory, WIDE". The numbers
  // run continuously across the rename, so they belong in the same series.
  it("accepts the pre-rename WIDE qualifier", () => {
    const wideLog = `
  Calls (advisory, WIDE): 6041 matched pairs checked, 1517 omit a ported-method call Rails makes — see output/call-mismatches-wide.json
`;

    expect(parseCallSummariesFromLogs(wideLog).calls).toEqual({
      matched: 4524,
      total: 6041,
      percent: 74.9,
      mismatched: 1517,
    });
  });

  it("returns null for both when the step never ran", () => {
    expect(parseCallSummariesFromLogs("")).toEqual({ calls: null, callArgs: null });
  });

  // A zero denominator would make percent NaN and poison the chart.
  it("ignores a summary with nothing compared", () => {
    const log =
      "  Calls (advisory): 0 matched pairs checked, 0 omit a ported-method call Rails makes\n";

    expect(parseCallSummariesFromLogs(log).calls).toBeNull();
  });
});
