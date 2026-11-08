import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";
import {
  missingCompareData,
  packagesMissingCompareData,
  type PackageMetaRow,
} from "../../lib/stats-sync/missing-compare-data.ts";

const meta = (pkg: string, description: string | null = null): PackageMetaRow => ({
  package: pkg,
  rails_counterpart: pkg,
  description,
  compare_keys: null,
});

describe("missingCompareData", () => {
  it("reports only a package missing rows with no reason", () => {
    const metas = [
      meta("complete"),
      meta("no-api"),
      meta("no-tests", "No Tests (Not in parity:test: compareTests: false)"),
    ];
    const found = missingCompareData(metas, new Set(["complete", "no-tests"]), new Set(["complete", "no-api"]));
    expect(found).toEqual([{ package: "no-api", missing: ["api"] }]);
  });

  it("skips a trails-only package and reads every compare key", () => {
    const metas = [
      { ...meta("ruby-compat"), rails_counterpart: null },
      { ...meta("actionpack"), compare_keys: "actiondispatch,actioncontroller" },
    ];
    expect(missingCompareData(metas, new Set(["actioncontroller"]), new Set(["actiondispatch"]))).toEqual([]);
  });

  it("reports exactly the ten no-data packages of the 2026-11-07 snapshot", async () => {
    const snapshot = JSON.parse(
      await getFs().readFile("test/fixtures/stats-sync/missing-compare-data-2026-11-07.json", "utf8"),
    ) as { package_meta: PackageMetaRow[]; api_compare_keys: string[]; test_compare_keys: string[] };
    const found = missingCompareData(
      snapshot.package_meta,
      new Set(snapshot.api_compare_keys),
      new Set(snapshot.test_compare_keys),
    );
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

  it("reads package_meta at the latest commit from STATS_SYNC_DB", async () => {
    const writable = env as Record<string, string | undefined>;
    const dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "missing-compare-data-"));
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");
    try {
      const { StatsSyncRecord } = await import("../../app/models/stats-sync/stats-sync-record.ts");
      await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
      await Base.establishConnection(statsSyncDatabaseConfig());
      try {
        await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
      } finally {
        await Base.removeConnection();
      }
      const connection = await StatsSyncRecord.leaseConnection();
      await connection.execute(`INSERT INTO package_meta (merge_commit_sha, pr_number, package, rails_counterpart)
        VALUES ('old', 1, 'gone', 'gone'), ('new', 2, 'rack-test', 'rack-test'), ('new', 2, 'rack', 'rack')`);
      await connection.execute(`INSERT INTO package_meta (merge_commit_sha, pr_number, package, rails_counterpart, description)
        VALUES ('new', 2, 'solid-cache', 'solid_cache', 'Solid Cache (Not in parity:api: no package) (Not in parity:test: no package)')`);
      await connection.execute(`INSERT INTO api_compare_stats (merge_commit_sha, pr_number, package) VALUES ('new', 2, 'rack')`);
      await connection.execute(
        `INSERT INTO test_compare_stats (merge_commit_sha, pr_number, package) VALUES ('new', 2, 'rack'), ('new', 2, 'rack-test')`,
      );
      try {
        expect(await packagesMissingCompareData()).toEqual([{ package: "rack-test", missing: ["api"] }]);
      } finally {
        await StatsSyncRecord.removeConnection();
      }
    } finally {
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  });
});
