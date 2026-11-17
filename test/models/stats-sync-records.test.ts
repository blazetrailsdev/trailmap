import { Base, MigrationContext } from "@blazetrails/activerecord";
import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";
import { TestCase } from "@blazetrails/activesupport/test-case";
import { withoutTransactionalTests } from "../support/transactional-tests.ts";

// Rails' `self.use_transactional_tests = false`: this file opens, migrates and
// deletes its own stats-sync database, which a test's fixture transaction
// would outlive. vitest isolates each file, so this reaches no other. It
// borrows `Base` to migrate that database, then hands `Base` back the suite's
// `primary` with `establishConnection()`, which fixture setup reads.
withoutTransactionalTests(TestCase);

const writable = env as Record<string, string | undefined>;
const BEYOND_32_BITS = 3_000_000_000;

describe("the stats sync models, whose attributes come from the schema", () => {
  let dir: string;
  let models: {
    StatsSyncRecord: typeof import("../../app/models/stats-sync/stats-sync-record.ts").StatsSyncRecord;
    PrComment: typeof import("../../app/models/stats-sync/pr-comment.ts").PrComment;
    PrFile: typeof import("../../app/models/stats-sync/pr-file.ts").PrFile;
  };

  beforeAll(async () => {
    dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-records-"));
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    models = {
      ...(await import("../../app/models/stats-sync/stats-sync-record.ts")),
      ...(await import("../../app/models/stats-sync/pr-comment.ts")),
      ...(await import("../../app/models/stats-sync/pr-file.ts")),
    };
    // Point the writers at this test's scratch database, as the initializer does at boot.
    await models.StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
    await Base.establishConnection(statsSyncDatabaseConfig());
    try {
      await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
    } finally {
      await Base.establishConnection();
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
