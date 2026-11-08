import { ApiCompareStat } from "../../app/models/stats-sync/api-compare-stat.ts";
import { PackageMeta } from "../../app/models/stats-sync/package-meta.ts";
import { TestCompareStat } from "../../app/models/stats-sync/test-compare-stat.ts";

/** A package the packages pages would show "no data" for, and which tiles. */
export interface MissingCompareData {
  package: string;
  missing: Array<"api" | "tests">;
}

// The literal trails writes into a skipped package's description:
// trails scripts/parity/package-summary.ts:354, `(Not in ${gate}: ${excluded})`.
const REASONS = { api: "Not in parity:api:", tests: "Not in parity:test:" } as const;

/**
 * The packages with a Rails counterpart whose api or tests tile reads no rows
 * under any of its compare keys, and whose description gives no reason for it.
 * Keys come from `PackageMeta#compareKeys` (app/models/concerns/compare-keys.ts), so the
 * check reads the same keys the packages pages' tiles do.
 */
export function missingCompareData(
  metas: PackageMeta[],
  apiKeys: Set<string>,
  testKeys: Set<string>,
): MissingCompareData[] {
  const found: MissingCompareData[] = [];
  for (const meta of metas) {
    if (meta.rails_counterpart == null) continue;
    const keys = meta.compareKeys();
    const missing = (["api", "tests"] as const).filter(
      (kind) =>
        !keys.some((key) => (kind === "api" ? apiKeys : testKeys).has(key)) &&
        !(meta.description ?? "").includes(REASONS[kind]),
    );
    if (missing.length > 0) found.push({ package: meta.package, missing: [...missing] });
  }
  return found.sort((a, b) => a.package.localeCompare(b.package));
}

/** `missingCompareData` over STATS_SYNC_DB's `package_meta` at its latest commit. */
export async function packagesMissingCompareData(): Promise<MissingCompareData[]> {
  const latest = await PackageMeta.order({ pr_number: "desc" }).first();
  if (latest == null) return [];
  const metas = await PackageMeta.where({ merge_commit_sha: latest.merge_commit_sha }).toArray();
  const apiKeys = new Set((await ApiCompareStat.distinct().pluck("package")) as string[]);
  const testKeys = new Set((await TestCompareStat.distinct().pluck("package")) as string[]);
  return missingCompareData(metas, apiKeys, testKeys);
}
