export interface TestComparePackageStats {
  matched: number;
  total: number;
  percent: number;
  skipped: number;
  filesMapped: number;
  filesTotal: number;
  misplaced: number;
  // The two advisory assertion counters the summary carries: a ported test
  // whose assertion COUNT differs from the Ruby, and one whose assertion KINDS
  // differ. Both are "the test exists and is mapped, but its body does not
  // check the same things", so they don't move the tests percent.
  assertionCountMismatch: number;
  assertionKindMismatch: number;
}

const SUMMARY_LINE =
  / {2}([\w-]+)[ \t]+—[ \t]+(\d+)\/(\d+) tests \(([\d.]+)%\)(?<details>[^\n|]*?)[ \t]+\|[ \t]+(\d+)\/(\d+) files[ \t]+\|[ \t]+(\d+) misplaced/g;

export function parseTestCompareFromLogs(logs: string): Map<string, TestComparePackageStats> {
  const results = new Map<string, TestComparePackageStats>();

  for (const m of logs.matchAll(SUMMARY_LINE)) {
    if (m[1] === "Overall") continue;
    const details = m.groups?.details ?? "";
    const skippedMatch = /(\d+)\s+skipped/.exec(details);
    // "1979 assertion-count-mismatch (see --assertions), 4067 assertion-kind-mismatch (...)"
    const countMatch = /(\d+)\s+assertion-count-mismatch/.exec(details);
    const kindMatch = /(\d+)\s+assertion-kind-mismatch/.exec(details);
    results.set(m[1], {
      matched: parseInt(m[2]),
      total: parseInt(m[3]),
      percent: parseFloat(m[4]),
      skipped: skippedMatch ? parseInt(skippedMatch[1]) : 0,
      filesMapped: parseInt(m[6]),
      filesTotal: parseInt(m[7]),
      misplaced: parseInt(m[8]),
      assertionCountMismatch: countMatch ? parseInt(countMatch[1]) : 0,
      assertionKindMismatch: kindMatch ? parseInt(kindMatch[1]) : 0,
    });
  }
  return results;
}
