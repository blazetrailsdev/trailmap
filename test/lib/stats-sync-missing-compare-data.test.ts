import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";
import { ApiCompareStat } from "../../app/models/stats-sync/api-compare-stat.ts";
import { PackageMeta } from "../../app/models/stats-sync/package-meta.ts";
import { StatsSyncRecord } from "../../app/models/stats-sync/stats-sync-record.ts";
import { TestCompareStat } from "../../app/models/stats-sync/test-compare-stat.ts";
import { packagesMissingCompareData } from "../../lib/stats-sync/missing-compare-data.ts";

interface Row {
  package: string;
  rails_counterpart: string | null;
  description: string | null;
  compare_keys: string | null;
}

const writable = env as Record<string, string | undefined>;
let dir: string;

const meta = (pkg: string, attributes: Partial<Row> = {}): Row => ({
  package: pkg,
  rails_counterpart: pkg,
  description: null,
  compare_keys: null,
  ...attributes,
});

async function seed(metas: Row[], apiKeys: string[], testKeys: string[], sha = "new", pr = 2): Promise<void> {
  const key = { merge_commit_sha: sha, pr_number: pr };
  await PackageMeta.insertAll(metas.map((m) => ({ ...key, ...m })));
  if (apiKeys.length > 0) await ApiCompareStat.insertAll(apiKeys.map((p) => ({ ...key, package: p })));
  if (testKeys.length > 0) await TestCompareStat.insertAll(testKeys.map((p) => ({ ...key, package: p })));
}

describe("packagesMissingCompareData", () => {
  beforeAll(async () => {
    dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "missing-compare-data-"));
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
    await Base.establishConnection(statsSyncDatabaseConfig());
    try {
      await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
    } finally {
      await Base.removeConnection();
    }
  });

  beforeEach(async () => {
    await PackageMeta.deleteAll();
    await ApiCompareStat.deleteAll();
    await TestCompareStat.deleteAll();
  });

  afterAll(async () => {
    try {
      await StatsSyncRecord.removeConnection();
    } finally {
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports only a package missing rows with no reason", async () => {
    await seed(
      [
        meta("complete"),
        meta("no-api"),
        meta("no-tests", { description: "No Tests (Not in parity:test: compareTests: false)" }),
        meta("solid-cache", {
          description: "Solid Cache (Not in parity:api: no package) (Not in parity:test: no package)",
        }),
      ],
      ["complete", "no-tests"],
      ["complete", "no-api"],
    );
    expect(await packagesMissingCompareData()).toEqual([{ package: "no-api", missing: ["api"] }]);
  });

  it("skips a trails-only package and reads every compare key", async () => {
    await seed(
      [meta("ruby-compat", { rails_counterpart: null }), meta("actionpack", { compare_keys: "actiondispatch,actioncontroller" })],
      ["actioncontroller"],
      ["actiondispatch"],
    );
    expect(await packagesMissingCompareData()).toEqual([]);
  });

  it("reads package_meta at the latest commit only", async () => {
    await seed([meta("gone")], [], [], "old", 1);
    await seed([meta("rack-test"), meta("rack")], ["rack"], ["rack", "rack-test"]);
    expect(await packagesMissingCompareData()).toEqual([{ package: "rack-test", missing: ["api"] }]);
  });

  it("reports exactly the ten no-data packages of the 2026-11-07 snapshot", async () => {
    const snapshot = JSON.parse(
      await getFs().readFile("test/fixtures/stats-sync/missing-compare-data-2026-11-07.json", "utf8"),
    ) as { package_meta: Row[]; api_compare_keys: string[]; test_compare_keys: string[] };
    await seed(snapshot.package_meta, snapshot.api_compare_keys, snapshot.test_compare_keys);
    const found = await packagesMissingCompareData();
    expect(found.map((p) => p.package)).toEqual([
      "actionpack",
      "did-you-mean",
      "et-orbi",
      "mini-magick",
      "mini-mime",
      "net-smtp",
      "rack-session",
      "rack-test",
      "solid-cable",
      "solid-queue",
    ]);
    expect(found.find((p) => p.package === "actionpack")!.missing).toEqual(["api", "tests"]);
  });
});
