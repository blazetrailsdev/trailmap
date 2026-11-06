import { beforeAll, describe, expect, it } from "vitest";
import { setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import { createScratchStatsDatabase } from "../models/stats-schema.ts";
import { Stats } from "../../app/models/stats.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { get } from "./request.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await createScratchStatsDatabase();
  setEnv("STATS_DB", ":memory:");
  const adapter = await Stats.connectionPool().leaseConnection();
  await adapter.execute(
    `INSERT INTO package_meta (merge_commit_sha, pr_number, package, rails_counterpart)
     VALUES ('sha1', 1, 'arel', 'arel')`,
  );
});

describe("GET /packages and each package's pages", () => {
  it("answers the index, linking each card to the package's page", async () => {
    const { status, body } = await get("/packages");
    expect(status).toBe(200);
    expect(body).toContain('href="/packages/arel"');
  });

  it("links the nav to the index", async () => {
    expect((await get("/packages")).body).toContain('<a href="/packages">Packages</a>');
  });

  it("answers a package's page with links to its tabs", async () => {
    const { status, body } = await get("/packages/arel");
    expect(status).toBe(200);
    expect(body).toContain('href="/packages/arel/files"');
    expect(body).toContain('href="/packages/arel/deviations"');
  });

  for (const path of ["/packages/arel/files", "/packages/arel/deviations"]) {
    it(`answers ${path}`, async () => {
      expect((await get(path)).status).toBe(200);
    });
  }

  for (const path of ["/packages/nope", "/packages/nope/files", "/packages/nope/deviations"]) {
    it(`answers ${path} for an unknown package with a 404`, async () => {
      expect((await get(path)).status).toBe(404);
    });
  }
});
