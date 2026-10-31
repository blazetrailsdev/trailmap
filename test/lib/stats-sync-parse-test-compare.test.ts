import { describe, expect, it } from "vitest";
import { parseTestCompareFromLogs } from "../../lib/stats-sync/parse-test-compare.ts";

const currentFormatLog = `
==========================================================================================
  globalid  —  131/131 tests (100%) (48 extra (TS only))  |  6/6 files  |  0 misplaced
==========================================================================================

==========================================================================================
  did-you-mean  —  10/20 tests (50%) (3 skipped, 2 assertion-count-mismatch (see --assertions), 7 assertion-kind-mismatch (see --assertions), 5 extra (TS only))  |  1/2 files  |  4 misplaced
==========================================================================================

  Overall: 141/151 tests (93.4%) (53 extra (TS only))  |  7/8 files  |  4 misplaced
`;

const legacyFormatLog = `
  globalid  —  131/131 tests (100%)  |  6/6 files  |  0 misplaced
  activerecord  —  900/1000 tests (90%) (12 skipped)  |  40/50 files  |  7 misplaced
`;

describe("parseTestCompareFromLogs", () => {
  it("parses the current summary format with nested parens and hyphenated packages", () => {
    const results = parseTestCompareFromLogs(currentFormatLog);

    expect([...results.keys()]).toEqual(["globalid", "did-you-mean"]);
    expect(results.get("globalid")).toEqual({
      matched: 131,
      total: 131,
      percent: 100,
      skipped: 0,
      filesMapped: 6,
      filesTotal: 6,
      misplaced: 0,
      assertionCountMismatch: 0,
      assertionKindMismatch: 0,
    });
    expect(results.get("did-you-mean")).toEqual({
      matched: 10,
      total: 20,
      percent: 50,
      skipped: 3,
      filesMapped: 1,
      filesTotal: 2,
      misplaced: 4,
      assertionCountMismatch: 2,
      assertionKindMismatch: 7,
    });
  });

  // The counters are advisory: a mapped test whose body checks a different
  // number (or different kinds) of things than the Ruby. They must not be
  // confused with skipped, which the same parenthetical also carries.
  it("reads both assertion counters off the real activerecord line", () => {
    const log =
      "  activerecord  —  8231/8407 tests (97.9%) (7 skipped, 6 wrong describe, " +
      "1979 assertion-count-mismatch (see --assertions), 4067 assertion-kind-mismatch " +
      "(see --assertions))  |  278/278 files  |  0 misplaced\n";

    expect(parseTestCompareFromLogs(log).get("activerecord")).toMatchObject({
      skipped: 7,
      assertionCountMismatch: 1979,
      assertionKindMismatch: 4067,
    });
  });

  it("parses the pre-#3825 summary format", () => {
    const results = parseTestCompareFromLogs(legacyFormatLog);

    expect(results.get("globalid")?.matched).toBe(131);
    expect(results.get("activerecord")).toEqual({
      matched: 900,
      total: 1000,
      percent: 90,
      skipped: 12,
      filesMapped: 40,
      filesTotal: 50,
      misplaced: 7,
      // The pre-#3825 format has no assertion counters at all.
      assertionCountMismatch: 0,
      assertionKindMismatch: 0,
    });
  });

  it("parses raw CI logs whose lines carry an ISO timestamp prefix", () => {
    const raw = currentFormatLog
      .split("\n")
      .map((line) => (line ? `2026-07-31T12:00:00.1234567Z ${line}` : line))
      .join("\n");

    expect(parseTestCompareFromLogs(raw).get("globalid")?.matched).toBe(131);
  });

  it("returns no packages when the summary lines are absent", () => {
    expect(parseTestCompareFromLogs("nothing to see here").size).toBe(0);
  });

  it("does not stitch a truncated summary line to the columns of the next line", () => {
    const truncated = [
      "  globalid  —  131/131 tests (100%)",
      "  |  6/6 files  |  0 misplaced",
    ].join("\n");

    expect(parseTestCompareFromLogs(truncated).size).toBe(0);
  });
});
