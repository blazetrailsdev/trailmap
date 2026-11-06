import { beforeAll, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import {
  createScratchStatsDatabase,
  seedApiCompare,
} from "../models/stats-schema.ts";
import { Stats } from "../../app/models/stats.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { Story } from "../../app/models/story.ts";
import { StoryPackage } from "../../app/models/story-package.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { PackagesController } from "../../app/controllers/packages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function stats(sql: string): Promise<void> {
  const adapter = await Stats.connectionPool().leaseConnection();
  await adapter.execute(sql);
}

async function index(): Promise<string> {
  const tc = await controllerTestCase(PackagesController);
  await tc.get("index");
  expect(tc.response.status).toBe(200);
  return String(tc.response.body);
}

/** The section of the page under heading `title`, up to the next heading. */
function group(body: string, title: string): string {
  const start = body.indexOf(`${title} <span`);
  const next = body.indexOf('<h2 class="section-title">', start);
  return body.slice(start, next === -1 ? undefined : next);
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");
  await createScratchStatsDatabase();
  setEnv("STATS_DB", ":memory:");

  // An older commit listed a package since removed; only the latest counts.
  for (const [sha, pr, pkg, counterpart] of [
    ["sha1", 1, "removed", "null"],
    ["sha2", 2, "arel", "'arel'"],
    ["sha2", 2, "activerecord", "'activerecord'"],
    ["sha2", 2, "ruby-compat", "null"],
  ] as const) {
    await stats(
      `INSERT INTO package_meta (merge_commit_sha, pr_number, package, rails_counterpart)
       VALUES ('${sha}', ${pr}, '${pkg}', ${counterpart})`,
    );
  }
  await seedApiCompare([
    {
      pr: 1,
      mergedAt: "2026-11-01",
      package: "arel",
      matched: 1,
      total: 2,
      percent: 50,
    },
    {
      pr: 2,
      mergedAt: "2026-11-02",
      package: "arel",
      matched: 9,
      total: 10,
      percent: 90,
    },
  ]);
  await stats(
    `INSERT INTO test_compare_stats (merge_commit_sha, pr_number, package, matched, total, percent)
     VALUES ('sha2', 2, 'arel', 3, 4, 75)`,
  );

  await Rfc.create({
    id: "0001-wide",
    status: "active",
    packages: ["arel", "activerecord"],
  });
  for (const [id, status, pkg] of [
    ["open-arel", "ready", "arel"],
    ["done-arel", "done", "arel"],
    ["orphan", "ready", null],
  ] as const) {
    await Story.create({ id, rfc_id: "0001-wide", status });
    if (pkg) await StoryPackage.create({ story_id: id, package: pkg });
  }
});

describe("PackagesController", () => {
  it("groups the latest package_meta commit by Rails counterpart", async () => {
    const body = await index();
    const counterparts = group(body, "Rails counterparts");
    const trailsOnly = group(body, "trails-only");
    expect(counterparts).toContain('href="/packages/arel"');
    expect(counterparts).toContain('href="/packages/activerecord"');
    expect(counterparts).not.toContain("ruby-compat");
    expect(trailsOnly).toContain('href="/packages/ruby-compat"');
    expect(trailsOnly).not.toContain("/packages/arel");
    expect(body).not.toContain("removed");
  });

  it("shows each package's latest api and tests ratio, or no data", async () => {
    const body = await index();
    const card = (name: string) => {
      const start = body.indexOf(`href="/packages/${name}"`);
      return body.slice(start, body.indexOf("</a>", start));
    };
    const arel = card("arel");
    expect(arel).toContain('<strong>90%</strong> <span class="muted">9 / 10</span>');
    expect(arel).toContain('<strong>75%</strong> <span class="muted">3 / 4</span>');
    expect(arel).toContain('style="width:90%"');
    expect(arel).toContain("1 open story");
    const ar = card("activerecord");
    expect(ar.match(/no data/g)).toHaveLength(2);
    expect(ar).not.toContain("pkg-fill");
    expect(ar).toContain("0 open stories");
  });

  it("shows the open unattributed story count", async () => {
    expect(await index()).toContain("1 open story attributed to no package");
  });
});
