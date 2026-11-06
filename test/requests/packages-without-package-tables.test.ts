import { beforeAll, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import { createScratchStatsDatabase } from "../models/stats-schema.ts";
import { Stats } from "../../app/models/stats.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { get } from "./request.ts";

/**
 * Production's STATS_DB as the trails cron fills it: the compare tables and
 * none of the package summaries, which only trailmap's stats-sync job writes.
 * Every packages page answered 500 on "no such table: package_meta".
 */
beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await createScratchStatsDatabase();
  setEnv("STATS_DB", ":memory:");
  const adapter = await Stats.connectionPool().leaseConnection();
  for (const table of [
    "package_meta", "package_tag_stats", "package_mark_stats", "package_file_stats",
    "package_tag_sites", "package_skip_tests", "claude_md_sections",
  ]) {
    await adapter.execute(`DROP TABLE IF EXISTS ${table}`);
  }
  // Creating the scratch tables cached their existence; production boots on a
  // file that never had them.
  Stats.connectionPool().schemaReflection.clearBang();
});

describe("the packages pages on a STATS_DB without package tables", () => {
  it("answers the index, saying there is no package data", async () => {
    const { status, body } = await get("/packages");
    expect(status).toBe(200);
    expect(body).toContain("No package data");
  });

  for (const path of ["/packages/arel", "/packages/arel/files", "/packages/arel/deviations"]) {
    it(`answers ${path} with a 404`, async () => {
      expect((await get(path)).status).toBe(404);
    });
  }
});
