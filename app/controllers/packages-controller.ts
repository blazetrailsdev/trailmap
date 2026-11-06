import { ApplicationController } from "./application-controller.ts";
import { hasStatsDatabase } from "../../config/database.ts";
import { PackageMeta } from "../models/package-meta.ts";
import { ApiCompareStat } from "../models/api-compare-stat.ts";
import { TestCompareStat } from "../models/test-compare-stat.ts";
import { CompareRun } from "../models/compare-run.ts";
import { Story } from "../models/story.ts";

/** A comparison's latest result: matched of total, and CI's percent. */
export interface Ratio {
  matched: number;
  total: number;
  percent: number;
}

/** One row of the index: a package, its counterpart and its latest numbers. */
export interface PackageRow {
  name: string;
  railsCounterpart: string | null;
  api: Ratio | null;
  tests: Ratio | null;
  openStories: number;
}

/** Each package's result on the latest merge commit that measured it. */
async function latestRatios(
  model: typeof CompareRun,
): Promise<Map<string, Ratio>> {
  const table = model.tableName;
  const rows = await model
    .where(
      `(package, pr_number) IN (SELECT package, MAX(pr_number) FROM ${table} GROUP BY package)`,
    )
    .toArray();
  return new Map(
    rows.map((row) => [
      row.package,
      { matched: row.matched, total: row.total, percent: row.percent },
    ]),
  );
}

/**
 * `/packages` — every trails package, grouped by whether it ports a Rails
 * counterpart (RFC 0222). The package list is the latest `package_meta`
 * commit's, not the compare tables', so a package no comparison measures is
 * still listed and says "no data".
 */
export class PackagesController extends ApplicationController {
  async index(): Promise<void> {
    const rows: PackageRow[] = [];
    const { byPackage, unattributed } = await Story.openCountsByPackage();
    if (hasStatsDatabase()) {
      const latest = await PackageMeta.order({ pr_number: "desc" }).first();
      const metas = latest
        ? await PackageMeta.where({ merge_commit_sha: latest.merge_commit_sha })
            .order("package")
            .toArray()
        : [];
      const api = await latestRatios(ApiCompareStat);
      const tests = await latestRatios(TestCompareStat);
      for (const meta of metas) {
        const name = String(meta.package);
        rows.push({
          name,
          railsCounterpart: meta.rails_counterpart ?? null,
          api: api.get(name) ?? null,
          tests: tests.get(name) ?? null,
          openStories: byPackage.get(name) ?? 0,
        });
      }
    }
    await this.render({
      locals: {
        configured: hasStatsDatabase(),
        counterparts: rows.filter((row) => row.railsCounterpart !== null),
        trailsOnly: rows.filter((row) => row.railsCounterpart === null),
        unattributed,
      },
    });
  }
}
