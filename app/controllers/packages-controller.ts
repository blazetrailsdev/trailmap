import { ApplicationController } from "./application-controller.ts";
import { hasStatsDatabase } from "../../config/database.ts";
import { PackageMeta } from "../models/package-meta.ts";
import { ApiCompareStat } from "../models/api-compare-stat.ts";
import { TestCompareStat } from "../models/test-compare-stat.ts";
import { CompareRun } from "../models/compare-run.ts";
import { Story } from "../models/story.ts";
import { Rfc } from "../models/rfc.ts";
import { StoryPath } from "../models/story-path.ts";
import { PackageTagStat } from "../models/package-tag-stat.ts";
import { PackageTagSite } from "../models/package-tag-site.ts";
import { PackageMarkStat } from "../models/package-mark-stat.ts";
import { PackageSkipTest } from "../models/package-skip-test.ts";
import { PackageFileStat } from "../models/package-file-stat.ts";
import { ClaudeMdSection } from "../models/claude-md-section.ts";
import { OPEN_STORY_STATUSES } from "../models/concerns/ranking.ts";
import { RecordNotFound } from "@blazetrails/activerecord";

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

/** Where a synced commit's file is read on GitHub. */
const TRAILS_BLOB = "https://github.com/blazetrailsdev/trails/blob";

/** The retired catch-all bucket, attributed per story by `touchingPackage`. */
const CATCH_ALL_BUCKET = "0023-surfaced-deviations";

/** A mark's latest value and its history, oldest first. */
export interface MarkRow {
  mark: string;
  latest: string;
  points: string;
}

/** One Rails file's row on the files page. */
export interface FileRow {
  railsFile: string;
  tsFile: string | null;
  matched: number;
  missing: number;
  testPercent: number | null;
  stories: string[];
}

/** An SVG polyline's `points` for `values` in an 80×16 box. */
function sparkline(values: number[]): string {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = values.length > 1 ? 80 / (values.length - 1) : 0;
  return values
    .map((v, i) => `${Math.round(i * step)},${Math.round(16 - ((v - min) * 16) / span)}`)
    .join(" ");
}

/** The latest `package_meta` row naming `name`, or a 404. */
async function latestMeta(name: string): Promise<PackageMeta> {
  const meta = hasStatsDatabase()
    ? await PackageMeta.where({ package: name }).order({ pr_number: "desc" }).first()
    : null;
  if (meta == null) throw new RecordNotFound(`No package ${name}`);
  return meta;
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

  /**
   * `/packages/:name/deviations` — where the package differs from Rails on
   * purpose: receipt counts drillable to their sites, marks with their trend,
   * parked tests by the section they cite, open surfaced-deviations stories,
   * and the cited `CLAUDE.md` sections.
   */
  async deviations(): Promise<void> {
    const name = String(this.params.get("name") ?? "");
    const meta = await latestMeta(name);
    const sha = meta.merge_commit_sha;
    const key = { merge_commit_sha: sha, package: name };
    const tags = await PackageTagStat.where(key).order("tag", "receipt").toArray();
    const sites = await PackageTagSite.where(key).order("file", "line").toArray();
    const sitesByTag = new Map<string, PackageTagSite[]>();
    for (const site of sites) {
      const tagKey = `${site.tag} ${site.receipt ?? ""}`;
      sitesByTag.set(tagKey, [...(sitesByTag.get(tagKey) ?? []), site]);
    }

    const history = new Map<string, PackageMarkStat[]>();
    for (const row of await PackageMarkStat.where({ package: name }).order("pr_number").toArray()) {
      history.set(row.mark, [...(history.get(row.mark) ?? []), row]);
    }
    const marks: MarkRow[] = [...history].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([mark, rows]) => {
      const last = rows.at(-1)!;
      const values = rows.map((r) => r.value ?? r.matched ?? 0);
      return {
        mark,
        latest: last.value != null ? String(last.value) : `${last.matched} / ${last.total}`,
        points: sparkline(values),
      };
    });

    const skips = new Map<string, PackageSkipTest[]>();
    for (const test of await PackageSkipTest.where(key).order("file", "test_name").toArray()) {
      const anchor = test.cited_anchor ?? "";
      skips.set(anchor, [...(skips.get(anchor) ?? []), test]);
    }
    const anchors = [...new Set([...sites.map((s) => s.cited_anchor), ...skips.keys()])].filter(
      (a): a is string => a != null && a !== "",
    );
    const sections = await ClaudeMdSection.where({ merge_commit_sha: sha, anchor: anchors })
      .order("file", "heading")
      .toArray();

    const bucket = `${name}-surfaced-deviations`;
    const buckets = (await Rfc.where("id LIKE ?", "%-surfaced-deviations").pluck("id"))
      .map(String)
      .filter((id) => /^\d{4}-/.test(id) && id.slice(5) === bucket);
    const bucketStories = await Story.where({ rfc_id: buckets, status: OPEN_STORY_STATUSES }).order("id").toArray();
    const catchAll = (await Story.touchingPackage(name)).filter(
      (story) => story.rfc_id === CATCH_ALL_BUCKET && OPEN_STORY_STATUSES.includes(story.status),
    );

    await this.render({
      locals: {
        name,
        sha,
        blob: `${TRAILS_BLOB}/${sha}`,
        tags,
        sitesByTag,
        marks,
        skips,
        sections,
        surfaced: [...bucketStories, ...catchAll],
      },
    });
  }

  /**
   * `/packages/:name/files` — every Rails file of the package: its TS port,
   * methods matched and missing, test match, and the open stories naming the
   * TS path. `?sort=missing` or `?sort=tests` orders the files before they
   * are grouped by directory.
   */
  async files(): Promise<void> {
    const name = String(this.params.get("name") ?? "");
    const meta = await latestMeta(name);
    const stats = await PackageFileStat.where({ merge_commit_sha: meta.merge_commit_sha, package: name })
      .order("rails_file")
      .toArray();
    const tsFiles = stats.map((row) => row.ts_file).filter((f): f is string => f != null);
    const paths = await StoryPath.where({ path: tsFiles }).toArray();
    const open = new Set(
      (await Story.where({ id: paths.map((p) => p.story_id), status: OPEN_STORY_STATUSES }).pluck("id")).map(String),
    );
    const storiesByPath = new Map<string, string[]>();
    for (const p of paths) {
      if (open.has(p.story_id)) storiesByPath.set(p.path, [...(storiesByPath.get(p.path) ?? []), p.story_id]);
    }

    const rows: FileRow[] = stats.map((row) => ({
      railsFile: row.rails_file,
      tsFile: row.ts_file,
      matched: row.methods_matched,
      missing: row.methods_missing,
      testPercent: row.tests_total > 0 ? Math.round((row.tests_matched * 100) / row.tests_total) : null,
      stories: (row.ts_file != null ? storiesByPath.get(row.ts_file) : undefined)?.sort() ?? [],
    }));
    const sort = String(this.params.get("sort") ?? "");
    if (sort === "missing") rows.sort((a, b) => b.missing - a.missing);
    if (sort === "tests") rows.sort((a, b) => (a.testPercent ?? 101) - (b.testPercent ?? 101));

    const groups = new Map<string, FileRow[]>();
    for (const row of rows) {
      const dir = row.railsFile.includes("/") ? row.railsFile.slice(0, row.railsFile.lastIndexOf("/")) : ".";
      groups.set(dir, [...(groups.get(dir) ?? []), row]);
    }
    await this.render({ locals: { name, sort, groups, count: rows.length } });
  }
}
