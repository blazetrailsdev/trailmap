import { env, getFs, getOs, getPath } from "@blazetrails/ruby-compat";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { describe, expect, it } from "vitest";
import { STATS_SYNC_MIGRATIONS_PATH, statsSyncDatabaseConfig } from "../../config/database.ts";

const FIXTURE = getPath().resolve("test/fixtures/stats-sync/package-summary.json");
// `run download <run> ... --name parity-outputs-<sha> --dir <dir>`: run 1 has
// the artifact, run 2's has expired.
const FAKE_GH = `#!/bin/sh
case "$*" in
  "run download 1 "*)
    for last; do :; done
    mkdir -p "$last/scripts/parity/output"
    cp "${FIXTURE}" "$last/scripts/parity/output/package-summary.json" ;;
  "run download 2 "*) echo "no valid artifacts found to download" >&2; exit 1 ;;
  *) echo '[]' ;;
esac
`;

describe("syncPackageSummaries", () => {
  it("lands a fixture artifact's rows and records an expired one in sync_log", async () => {
    const writable = env as Record<string, string | undefined>;
    const dir = getFs().mkdtempSync!(getPath().join(getOs().tmpdir!(), "stats-sync-summary-"));
    getFs().writeFileSync(getPath().join(dir, "gh"), FAKE_GH);
    getFs().chmodSync!(getPath().join(dir, "gh"), 0o755);
    const path = writable["PATH"];
    writable["PATH"] = `${dir}:${path}`;
    writable["STATS_SYNC_DB"] = getPath().join(dir, "stats.db");

    try {
      const { syncPackageSummaries } = await import("../../lib/stats-sync/sync.ts");
      const { StatsSyncRecord } = await import("../../app/models/stats-sync/stats-sync-record.ts");
      await StatsSyncRecord.establishConnection(statsSyncDatabaseConfig());
      await Base.establishConnection(statsSyncDatabaseConfig());
      try {
        await new MigrationContext([getPath().resolve(STATS_SYNC_MIGRATIONS_PATH)]).migrate();
      } finally {
        await Base.removeConnection();
      }
      const adapter = await StatsSyncRecord.leaseConnection();
      await adapter.execute(`INSERT INTO workflow_runs (id, head_sha, pr_number, event, conclusion, workflow_name)
        VALUES (1, 'abc', 7, 'push', 'success', 'CI'), (2, 'def', 6, 'push', 'success', 'CI')`);

      expect(await syncPackageSummaries("latest")).toBe(1);
      const q = async (sql: string) => (await adapter.selectAll(sql)).toArray();

      expect(
        await q(
          "SELECT merge_commit_sha, pr_number, package, rails_counterpart, claude_md FROM package_meta",
        ),
      ).toEqual([
        {
          merge_commit_sha: "abc",
          pr_number: 7,
          package: "arel",
          rails_counterpart: "activerecord/lib/arel",
          claude_md: "packages/arel/CLAUDE.md",
        },
      ]);
      expect(await q("SELECT tag, receipt, count FROM package_tag_stats ORDER BY receipt")).toEqual(
        [
          { tag: "@noRailsEquivalent", receipt: "CONVERGEABLE", count: 1 },
          { tag: "@noRailsEquivalent", receipt: "PERMANENT", count: 2 },
          { tag: "@noRailsEquivalent", receipt: "none", count: 0 },
        ],
      );
      expect(
        await q("SELECT mark, value, matched, total FROM package_mark_stats ORDER BY mark"),
      ).toEqual([
        { mark: "callMismatchesExclude", value: 4, matched: null, total: null },
        { mark: "extraSurfaceNovel", value: null, matched: null, total: null },
        { mark: "modules.newModule", value: 1, matched: null, total: null },
        { mark: "modules.superMethod", value: 0, matched: null, total: null },
        { mark: "params", value: null, matched: 9, total: 10 },
        { mark: "sends", value: 3, matched: null, total: null },
      ]);
      expect(
        await q(
          "SELECT rails_file, ts_file, methods_matched, methods_missing, tests_matched, tests_total FROM package_file_stats",
        ),
      ).toEqual([
        {
          rails_file: "arel/nodes/node.rb",
          ts_file: "packages/arel/src/nodes/node.ts",
          methods_matched: 5,
          methods_missing: 1,
          tests_matched: 2,
          tests_total: 3,
        },
      ]);
      expect(
        await q(
          "SELECT package, tag, receipt, file, line, declaration, cited_anchor FROM package_tag_sites",
        ),
      ).toEqual([
        {
          package: "arel",
          tag: "@noRailsEquivalent",
          receipt: "PERMANENT",
          file: "packages/arel/src/a.ts",
          line: 12,
          declaration: "visit",
          cited_anchor: null,
        },
      ]);
      expect(
        await q("SELECT package, file, test_name, cited_anchor FROM package_skip_tests"),
      ).toEqual([
        {
          package: "arel",
          file: "packages/arel/src/a.test.ts",
          test_name: "forks",
          cited_anchor: "runtime-facts-node-does-not-expose",
        },
      ]);
      expect(await q("SELECT file, anchor FROM claude_md_sections")).toEqual([
        { file: "CLAUDE.md", anchor: "fidelity-is-the-job" },
      ]);
      expect(await q("SELECT missing_artifact FROM sync_log")).toEqual([
        { missing_artifact: "def" },
      ]);

      // Neither commit is tried again.
      expect(await syncPackageSummaries("latest")).toBe(0);
      await StatsSyncRecord.removeConnection();
    } finally {
      writable["PATH"] = path;
      delete writable["STATS_SYNC_DB"];
      getFs().rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
