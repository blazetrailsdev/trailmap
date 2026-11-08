import { StatsSyncRecord } from "../../app/models/stats-sync/stats-sync-record.ts";

/** The `package_meta` columns the check reads. */
export interface PackageMetaRow {
  package: string;
  rails_counterpart: string | null;
  description: string | null;
  compare_keys: string | null;
}

/** A package the packages pages would show "no data" for, and which tiles. */
export interface MissingCompareData {
  package: string;
  missing: Array<"api" | "tests">;
}

const REASONS = { api: "Not in parity:api:", tests: "Not in parity:test:" } as const;

/**
 * The packages with a Rails counterpart whose api or tests tile reads no rows
 * under any of its compare keys, and whose description gives no reason for it.
 * Keys split as `PackageMeta#compareKeys` (app/models/package-meta.ts) does.
 */
export function missingCompareData(
  metas: PackageMetaRow[],
  apiKeys: Set<string>,
  testKeys: Set<string>,
): MissingCompareData[] {
  const found: MissingCompareData[] = [];
  for (const meta of metas) {
    if (meta.rails_counterpart == null) continue;
    const keys = meta.compare_keys ? meta.compare_keys.split(",") : [meta.package];
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
  const connection = await StatsSyncRecord.leaseConnection();
  const metas = (
    await connection.selectAll(`
    SELECT package, rails_counterpart, description, compare_keys FROM package_meta
    WHERE merge_commit_sha = (SELECT merge_commit_sha FROM package_meta ORDER BY pr_number DESC LIMIT 1)
  `)
  ).toArray() as unknown as PackageMetaRow[];
  const keys = async (table: string) =>
    new Set(
      (await connection.selectAll(`SELECT DISTINCT package FROM ${table}`))
        .toArray()
        .map((row) => (row as { package: string }).package),
    );
  return missingCompareData(metas, await keys("api_compare_stats"), await keys("test_compare_stats"));
}
