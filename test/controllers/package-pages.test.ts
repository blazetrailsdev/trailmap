import { beforeAll, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import { createScratchStatsDatabase } from "../models/stats-schema.ts";
import { Stats } from "../../app/models/stats.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { Story } from "../../app/models/story.ts";
import { StoryPackage } from "../../app/models/story-package.ts";
import { StoryPath } from "../../app/models/story-path.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { PackagesController } from "../../app/controllers/packages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function stats(sql: string): Promise<void> {
  const adapter = await Stats.connectionPool().leaseConnection();
  await adapter.execute(sql);
}

async function page(action: string, params: Record<string, string>): Promise<string> {
  const tc = await controllerTestCase(PackagesController);
  await tc.get(action, { params });
  expect(tc.response.status).toBe(200);
  return String(tc.response.body);
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");
  await createScratchStatsDatabase();
  setEnv("STATS_DB", ":memory:");
  await stats(`INSERT INTO package_meta (merge_commit_sha, pr_number, package) VALUES ('sha1', 1, 'arel'), ('sha2', 2, 'arel')`);

  for (const sql of [
    `INSERT INTO package_tag_stats (merge_commit_sha, pr_number, package, tag, receipt, count) VALUES
       ('sha2', 2, 'arel', '@noRailsEquivalent', 'PERMANENT', 1), ('sha2', 2, 'arel', '@perf', 'none', 0)`,
    `INSERT INTO package_tag_sites (merge_commit_sha, pr_number, package, tag, receipt, file, line, declaration, cited_anchor) VALUES
       ('sha2', 2, 'arel', '@noRailsEquivalent', 'PERMANENT', 'packages/arel/src/a.ts', 12, 'visit', 'fidelity-is-the-job')`,
    `INSERT INTO package_mark_stats (merge_commit_sha, pr_number, package, mark, value, matched, total) VALUES
       ('sha1', 1, 'arel', 'sends', 5, NULL, NULL), ('sha2', 2, 'arel', 'sends', 3, NULL, NULL),
       ('sha2', 2, 'arel', 'params', NULL, 9, 10)`,
    `INSERT INTO package_skip_tests (merge_commit_sha, pr_number, package, file, test_name, cited_anchor) VALUES
       ('sha2', 2, 'arel', 'packages/arel/src/a.test.ts', 'forks', 'runtime-facts')`,
    `INSERT INTO claude_md_sections (merge_commit_sha, pr_number, file, heading, anchor, lede) VALUES
       ('sha2', 2, 'CLAUDE.md', 'Fidelity is the job', 'fidelity-is-the-job', 'trails is a re-implementation'),
       ('sha2', 2, 'CLAUDE.md', 'Runtime facts', 'runtime-facts', 'Node has no fork'),
       ('sha2', 2, 'CLAUDE.md', 'Uncited', 'uncited', 'nobody cites this')`,
    `INSERT INTO package_file_stats (merge_commit_sha, pr_number, package, rails_file, ts_file, methods_matched, methods_missing, tests_matched, tests_total) VALUES
       ('sha2', 2, 'arel', 'arel/nodes/node.rb', 'packages/arel/src/nodes/node.ts', 5, 1, 7, 40),
       ('sha2', 2, 'arel', 'arel/nodes/binary.rb', NULL, 0, 7, 0, 0),
       ('sha2', 2, 'arel', 'arel/table.rb', 'packages/arel/src/table.ts', 9, 0, 3, 3)`,
  ]) {
    await stats(sql);
  }
  await Rfc.create({ id: "0124-arel-surfaced-deviations", status: "active" });
  await Rfc.create({ id: "0023-surfaced-deviations", status: "active", packages: ["arel", "activerecord"] });
  for (const [id, rfc, status, pkg] of [
    ["arel-bucket-open", "0124-arel-surfaced-deviations", "ready", null],
    ["arel-bucket-done", "0124-arel-surfaced-deviations", "done", null],
    ["catch-all-arel", "0023-surfaced-deviations", "ready", "arel"],
    ["catch-all-ar", "0023-surfaced-deviations", "ready", "activerecord"],
  ] as const) {
    await Story.create({ id, rfc_id: rfc, status });
    if (pkg) await StoryPackage.create({ story_id: id, package: pkg });
  }
  await Rfc.create({ id: "0001-wide", status: "active", packages: ["arel", "activerecord"] });
  for (const id of ["open-arel", "done-arel"]) {
    await Story.create({ id, rfc_id: "0001-wide", status: id === "open-arel" ? "ready" : "done" });
  }
  await StoryPath.create({ story_id: "open-arel", path: "packages/arel/src/nodes/node.ts" });
  await StoryPath.create({ story_id: "done-arel", path: "packages/arel/src/nodes/node.ts" });
});

describe("PackagesController#deviations", () => {
  it("counts receipts and links each site at the synced commit", async () => {
    const body = await page("deviations", { name: "arel" });
    expect(body).toContain("<code>@noRailsEquivalent</code> <span class=\"tag\">PERMANENT</span> <strong>1</strong>");
    expect(body).toContain("<code>@perf</code> <strong>0</strong>");
    expect(body).toContain(
      'href="https://github.com/blazetrailsdev/trails/blob/sha2/packages/arel/src/a.ts#L12"><code>packages/arel/src/a.ts:12</code>',
    );
  });

  it("shows each mark's latest value with a sparkline", async () => {
    const body = await page("deviations", { name: "arel" });
    expect(body).toContain('<code>sends</code></td><td><strong>3</strong></td><td><svg class="sparkline"');
    expect(body).toContain('points="0,0 80,16"');
    expect(body).toContain("<code>params</code></td><td><strong>9 / 10</strong>");
  });

  it("groups permanent skips by cited section and lists only cited sections", async () => {
    const body = await page("deviations", { name: "arel" });
    expect(body).toContain('<a href="#runtime-facts">runtime-facts</a> <span class="muted">1</span>');
    expect(body).toContain("<code>packages/arel/src/a.test.ts</code> forks");
    expect(body).toContain('href="https://github.com/blazetrailsdev/trails/blob/sha2/CLAUDE.md#fidelity-is-the-job">Fidelity is the job</a>');
    expect(body).toContain("Node has no fork");
    expect(body).not.toContain("nobody cites this");
  });

  it("lists the open stories of the bucket and the catch-all attributed to the package", async () => {
    const body = await page("deviations", { name: "arel" });
    expect(body).toContain('href="/story/arel-bucket-open"');
    expect(body).toContain('href="/story/catch-all-arel"');
    expect(body).not.toContain("arel-bucket-done");
    expect(body).not.toContain("catch-all-ar\"");
  });

  it("answers 404 for an unknown package", async () => {
    const tc = await controllerTestCase(PackagesController);
    await expect(tc.get("deviations", { params: { name: "nope" } })).rejects.toThrow("No package nope");
  });
});

describe("PackagesController#files", () => {
  it("groups Rails files by directory with port, methods, tests and open stories", async () => {
    const body = await page("files", { name: "arel" });
    expect(body).toContain('<h2 class="section-title">arel/nodes <span class="muted">2</span>');
    expect(body).toContain('<span class="muted">unported</span>');
    expect(body).toContain("<td>5</td>\n        <td>1</td>\n        <td>18%</td>");
    expect(body).toContain("<td>—</td>");
    expect(body).toContain('<summary>1</summary><a href="/story/open-arel">open-arel</a>');
    expect(body).not.toContain("done-arel");
  });

  it("sorts by missing methods or by test match", async () => {
    const byMissing = await page("files", { name: "arel", sort: "missing" });
    expect(byMissing.indexOf("binary.rb")).toBeLessThan(byMissing.indexOf("node.rb"));
    expect(byMissing.indexOf("node.rb")).toBeLessThan(byMissing.indexOf("table.rb"));
    const byTests = await page("files", { name: "arel", sort: "tests" });
    expect(byTests.indexOf("table.rb")).toBeGreaterThan(byTests.indexOf("node.rb"));
    expect(byTests.indexOf("<h2", byTests.indexOf("node.rb"))).toBeGreaterThan(byTests.indexOf("binary.rb"));
  });
});
