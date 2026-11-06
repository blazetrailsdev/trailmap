import { PackageMeta } from "../../app/models/stats-sync/package-meta.ts";
import { PackageTagStat } from "../../app/models/stats-sync/package-tag-stat.ts";
import { PackageMarkStat } from "../../app/models/stats-sync/package-mark-stat.ts";
import { PackageFileStat } from "../../app/models/stats-sync/package-file-stat.ts";
import { PackageTagSite } from "../../app/models/stats-sync/package-tag-site.ts";
import { PackageSkipTest } from "../../app/models/stats-sync/package-skip-test.ts";
import { ClaudeMdSection } from "../../app/models/stats-sync/claude-md-section.ts";

type Ratio = { matched: number; total: number } | null;

/** The shape of trails' `scripts/parity/output/package-summary.json` (`Summary`). */
export interface PackageSummaryJson {
  packages: {
    name: string;
    railsCounterpart: string | null;
    description: string | null;
    claudeMd: string | null;
    tags: Record<string, Record<string, number>>;
    marks: Record<string, number | null | Record<string, number>>;
    params: Ratio;
    predicates: Ratio;
    permanentSkips: Record<string, { file: string; line: number; testName: string | null }[]>;
  }[];
  tagSites: {
    package: string;
    tag: string;
    receipt: string | null;
    file: string;
    line: number;
    declaration: string | null;
    citedSection: string | null;
  }[];
  files: {
    package: string;
    rubyFile: string;
    tsFile: string | null;
    methodsMatched: number;
    methodsMissing: number;
    testsMatched: number;
    testsTotal: number;
  }[];
  claudeSections: {
    file: string;
    heading: string;
    anchor: string;
    lede: string;
  }[];
}

/**
 * Upsert one commit's summary. The per-commit tables gain its rows; the three
 * latest-only tables are replaced, but only when `latest` says this commit is
 * the newest one synced so far.
 */
export async function storePackageSummary(
  summary: PackageSummaryJson,
  mergeCommitSha: string,
  prNumber: number,
  latest: boolean,
): Promise<void> {
  const key = { merge_commit_sha: mergeCommitSha, pr_number: prNumber };
  const meta: Record<string, unknown>[] = [];
  const tags: Record<string, unknown>[] = [];
  const marks: Record<string, unknown>[] = [];
  const skips: Record<string, unknown>[] = [];
  for (const pkg of summary.packages) {
    meta.push({
      ...key,
      package: pkg.name,
      rails_counterpart: pkg.railsCounterpart,
      description: pkg.description,
      claude_md: pkg.claudeMd,
    });
    for (const [tag, receipts] of Object.entries(pkg.tags)) {
      for (const [receipt, count] of Object.entries(receipts)) {
        tags.push({ ...key, package: pkg.name, tag, receipt, count });
      }
    }
    for (const [mark, value] of Object.entries(pkg.marks)) {
      if (value !== null && typeof value === "object") {
        for (const [kind, n] of Object.entries(value)) {
          marks.push({
            ...key,
            package: pkg.name,
            mark: `${mark}.${kind}`,
            value: n,
            matched: null,
            total: null,
          });
        }
      } else {
        marks.push({
          ...key,
          package: pkg.name,
          mark,
          value,
          matched: null,
          total: null,
        });
      }
    }
    for (const mark of ["params", "predicates"] as const) {
      const ratio = pkg[mark];
      if (ratio === null) continue;
      marks.push({
        ...key,
        package: pkg.name,
        mark,
        value: null,
        matched: ratio.matched,
        total: ratio.total,
      });
    }
    for (const [anchor, tests] of Object.entries(pkg.permanentSkips)) {
      for (const test of tests) {
        skips.push({
          ...key,
          package: pkg.name,
          file: test.file,
          test_name: test.testName,
          cited_anchor: anchor,
        });
      }
    }
  }
  const files = summary.files.map((f) => ({
    ...key,
    package: f.package,
    rails_file: f.rubyFile,
    ts_file: f.tsFile,
    methods_matched: f.methodsMatched,
    methods_missing: f.methodsMissing,
    tests_matched: f.testsMatched,
    tests_total: f.testsTotal,
  }));

  // One transaction, so a failure leaves no `package_meta` row marking the commit synced.
  await PackageMeta.transaction(async () => {
    if (meta.length > 0)
      await PackageMeta.upsertAll(meta, {
        uniqueBy: ["merge_commit_sha", "package"],
      });
    if (tags.length > 0) {
      await PackageTagStat.upsertAll(tags, {
        uniqueBy: ["merge_commit_sha", "package", "tag", "receipt"],
      });
    }
    if (marks.length > 0) {
      await PackageMarkStat.upsertAll(marks, {
        uniqueBy: ["merge_commit_sha", "package", "mark"],
      });
    }
    if (files.length > 0) {
      await PackageFileStat.upsertAll(files, {
        uniqueBy: ["merge_commit_sha", "package", "rails_file"],
      });
    }
    if (!latest) return;

    await PackageTagSite.deleteAll();
    await PackageSkipTest.deleteAll();
    await ClaudeMdSection.deleteAll();
    const sites = summary.tagSites.map((s) => ({
      ...key,
      package: s.package,
      tag: s.tag,
      receipt: s.receipt,
      file: s.file,
      line: s.line,
      declaration: s.declaration,
      cited_anchor: s.citedSection,
    }));
    const sections = summary.claudeSections.map((s) => ({
      ...key,
      file: s.file,
      heading: s.heading,
      anchor: s.anchor,
      lede: s.lede,
    }));
    if (sites.length > 0) await PackageTagSite.insertAll(sites);
    if (skips.length > 0) await PackageSkipTest.insertAll(skips);
    if (sections.length > 0) await ClaudeMdSection.insertAll(sections);
  });
}
