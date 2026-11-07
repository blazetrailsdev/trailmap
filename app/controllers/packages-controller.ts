import { ApplicationController } from "./application-controller.ts";
import { hasStatsDatabase } from "../../config/database.ts";
import { PackageMeta } from "../models/package-meta.ts";
import { ApiCompareStat } from "../models/api-compare-stat.ts";
import { TestCompareStat } from "../models/test-compare-stat.ts";
import { CompareRun } from "../models/compare-run.ts";
import { ApiCallsStat } from "../models/api-calls-stat.ts";
import { ApiCallArgsStat } from "../models/api-call-args-stat.ts";
import { ApiComparePrivatesStat } from "../models/api-compare-privates-stat.ts";
import { Event } from "../models/event.ts";
import { Story } from "../models/story.ts";
import { Rfc } from "../models/rfc.ts";
import { StoryPath } from "../models/story-path.ts";
import { PackageTagStat } from "../models/package-tag-stat.ts";
import { PackageTagSite } from "../models/package-tag-site.ts";
import { PackageMarkStat } from "../models/package-mark-stat.ts";
import { PackageSkipTest } from "../models/package-skip-test.ts";
import { PackageFileStat } from "../models/package-file-stat.ts";
import { ClaudeMdSection } from "../models/claude-md-section.ts";
import { effectiveStoryStatus } from "../models/concerns/effective-status.ts";
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

/** A gate's tile: its latest ratio and trend, or `latest: null` for no data. */
export interface Tile {
  label: string;
  latest: Ratio | null;
  points: string;
}

/** The overview's tiles, in order; `mark` gates read `package_mark_stats`. */
const GATES: { label: string; model?: typeof CompareRun; mark?: string; assertions?: boolean }[] = [
  { label: "api", model: ApiCompareStat },
  { label: "calls", model: ApiCallsStat },
  { label: "call args", model: ApiCallArgsStat },
  { label: "params", mark: "params" },
  { label: "predicates", mark: "predicates" },
  { label: "tests", model: TestCompareStat },
  { label: "assertions", model: TestCompareStat, assertions: true },
  { label: "privates", model: ApiComparePrivatesStat },
];

/** The statuses the overview counts, and the work page's group order. */
const COUNTED_STATUSES = ["ready", "in-progress", "blocked", "done"];
const WORK_ORDER = ["ready", "in-progress", "blocked", "draft"];

/** Each story's effective status (`shared/_status-badge`'s rule), by id. */
async function effectiveStatuses(stories: Story[]): Promise<Map<string, string>> {
  const rfcStatus = new Map<string, string>();
  for (const rfc of await Rfc.where({ id: [...new Set(stories.map((s) => s.rfc_id))] }).toArray()) {
    rfcStatus.set(rfc.id, rfc.status);
  }
  return new Map(stories.map((s) => [s.id, effectiveStoryStatus(rfcStatus.get(s.rfc_id), s.status) ?? s.status]));
}

/** The Monday (UTC) of `at`'s week, as `YYYY-MM-DD`. */
function weekOf(at: string): string {
  const day = new Date(at);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
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

/**
 * Whether `STATS_DB` holds the package summaries. The tables are written by
 * trailmap's own stats-sync job (STATS_SYNC_DB, `db/stats-sync-migrate`), so a
 * `STATS_DB` filled by the trails cron has the compare tables and not these.
 */
async function hasPackageData(): Promise<boolean> {
  return hasStatsDatabase() && (await PackageMeta.tableExists());
}

/** A mark's latest value: its value, else matched of total (NULL matched as 0), else a dash. */
function markLatest(row: { value: number | null; matched: number | null; total: number | null }): string {
  if (row.value != null) return String(row.value);
  if (row.total == null) return "—";
  return `${row.matched ?? 0} / ${row.total}`;
}

/** The latest `package_meta` row naming `name`, or a 404. */
async function latestMeta(name: string): Promise<PackageMeta> {
  const meta = (await hasPackageData())
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
    const packageData = await hasPackageData();
    if (packageData) {
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
        packageData,
        counterparts: rows.filter((row) => row.railsCounterpart !== null),
        trailsOnly: rows.filter((row) => row.railsCounterpart === null),
        unattributed,
      },
    });
  }

  /**
   * `/packages/:name` — counterpart and purpose, a tile per gate, story
   * counts by status and the RFCs touching the package, and "Start here":
   * the top ready stories in queue order, the package `CLAUDE.md`, and the
   * Rails file with most missing methods.
   */
  async show(): Promise<void> {
    const name = String(this.params.get("name") ?? "");
    const meta = await latestMeta(name);
    const sha = meta.merge_commit_sha;
    const tiles: Tile[] = [];
    for (const gate of GATES) {
      let ratios: Ratio[];
      if (gate.mark) {
        ratios = (await PackageMarkStat.where({ package: name, mark: gate.mark }).order("pr_number").toArray())
          .filter((row) => row.total != null)
          .map((row) => {
            const matched = row.matched ?? 0;
            return { matched, total: row.total!, percent: row.total! > 0 ? Math.round((matched * 1000) / row.total!) / 10 : 0 };
          });
      } else {
        const rows = await gate.model!.where({ package: name }).order("pr_number").toArray();
        ratios = rows.map((row) => {
          if (!gate.assertions) return { matched: row.matched, total: row.total, percent: row.percent };
          const matched = row.matched - ((row as TestCompareStat).assertion_count_mismatch ?? 0);
          return {
            matched,
            total: row.matched,
            percent: row.matched > 0 ? Math.round((matched * 1000) / row.matched) / 10 : 0,
          };
        });
      }
      tiles.push({
        label: gate.label,
        latest: ratios.at(-1) ?? null,
        points: ratios.length > 0 ? sparkline(ratios.map((r) => r.percent)) : "",
      });
    }

    const stories = await Story.touchingPackage(name);
    const statuses = await effectiveStatuses(stories);
    const counts = COUNTED_STATUSES.map((status) => ({
      status,
      count: stories.filter((story) => statuses.get(story.id) === status).length,
    }));
    const rfcs = [
      ...new Set(stories.filter((story) => OPEN_STORY_STATUSES.includes(statuses.get(story.id)!)).map((story) => story.rfc_id)),
    ].sort();
    const ids = new Set(stories.map((story) => story.id));
    const ready = (await Story.claimable()).filter((story) => ids.has(story.id)).slice(0, 3);
    const topFile = await PackageFileStat.where({ merge_commit_sha: sha, package: name })
      .where("methods_missing > 0")
      .order({ methods_missing: "desc" }, "rails_file")
      .first();

    await this.render({
      locals: {
        name,
        meta,
        blob: `${TRAILS_BLOB}/${sha}`,
        tiles,
        counts,
        rfcs,
        ready,
        topFile,
      },
    });
  }

  /**
   * `/packages/:name/work` — the stories attributed to the package, grouped
   * by RFC, ready first, then in-progress, blocked and draft, done collapsed;
   * and a weekly count of their `done` events.
   */
  async work(): Promise<void> {
    const name = String(this.params.get("name") ?? "");
    await latestMeta(name);
    const stories = await Story.touchingPackage(name);
    const statuses = await effectiveStatuses(stories);
    const rank = (story: Story): number => {
      const i = WORK_ORDER.indexOf(statuses.get(story.id)!);
      return i === -1 ? WORK_ORDER.length : i;
    };
    const groups = new Map<string, { open: Story[]; done: Story[] }>();
    for (const story of [...stories].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const group = groups.get(story.rfc_id) ?? { open: [], done: [] };
      (["done", "closed"].includes(statuses.get(story.id)!) ? group.done : group.open).push(story);
      groups.set(story.rfc_id, group);
    }
    const sorted = new Map([...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

    const weeks = new Map<string, number>();
    const events = await Event.where({ verb: "done", story_id: stories.map((story) => story.id) }).order("at").toArray();
    const seen = new Set<string>();
    for (const event of events) {
      const week = weekOf(String(event.at));
      if (seen.has(`${week} ${event.story_id}`)) continue;
      seen.add(`${week} ${event.story_id}`);
      weeks.set(week, (weeks.get(week) ?? 0) + 1);
    }
    const burndown = [...weeks].map(([week, count]) => ({ week, count }));
    const max = Math.max(1, ...burndown.map((row) => row.count));

    await this.render({ locals: { name, groups: sorted, statuses, burndown, max } });
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
        latest: markLatest(last),
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
