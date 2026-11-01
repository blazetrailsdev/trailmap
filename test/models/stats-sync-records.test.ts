import { Base, MigrationContext } from "@blazetrails/activerecord";
import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";

const writable = env as Record<string, string | undefined>;
const BEYOND_32_BITS = 3_000_000_000;

describe("the stats sync models, whose attributes come from the schema", () => {
  let dir: string;
  let models: typeof import("../../app/models/stats-sync/index.ts");

  beforeAll(async () => {
    dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-records-"));
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    models = await import("../../app/models/stats-sync/index.ts");
    await Base.establishConnection(statsSyncDatabaseConfig());
    try {
      await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
    } finally {
      await Base.removeConnection();
    }
  });

  afterAll(async () => {
    await models.StatsSyncRecord.removeConnection();
    delete writable["STATS_SYNC_DB"];
    getFs().rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a GitHub id beyond 32 bits as a number", async () => {
    await models.PrComment.upsertAll([{ id: BEYOND_32_BITS, pr_number: 1 }]);
    const comment = await models.PrComment.first();
    expect(comment?.readAttribute("id")).toBe(BEYOND_32_BITS);
  });

  it("writes and reads the changes column, which has no attribute writer", async () => {
    await models.PrFile.insertAll([{ pr_number: 1, filename: "a.ts", changes: 3 }]);
    const file = await models.PrFile.first();
    expect(file?.readAttribute("changes")).toBe(3);
  });
});
