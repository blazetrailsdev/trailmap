import { Migration } from "@blazetrails/activerecord";
import type { SQLite3Adapter } from "@blazetrails/activerecord/connection-adapters/sqlite3-adapter.js";

/**
 * RFC 0222's "Data" tables, written from each merged commit's
 * `parity-outputs-<sha>` artifact (`scripts/parity/output/package-summary.json`).
 * The first four are per commit, keyed by `merge_commit_sha`, `pr_number`; the
 * last three hold the latest synced commit only and are replaced on each sync.
 * `sync_log.missing_artifact` records a commit whose artifact was gone, so the
 * sync skips it rather than retrying it every run.
 */
export class CreatePackageSummaryTables extends Migration.get(8) {
  async up(): Promise<void> {
    const adapter = (await this.connection) as SQLite3Adapter;
    await adapter.createTable("package_meta", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("rails_counterpart");
      t.text("description");
      t.string("claude_md");
      t.index(["merge_commit_sha", "package"], { unique: true });
    });
    await adapter.createTable("package_tag_stats", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("tag");
      t.string("receipt");
      t.integer("count");
      t.index(["merge_commit_sha", "package", "tag", "receipt"], {
        unique: true,
      });
    });
    await adapter.createTable("package_mark_stats", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("mark");
      t.integer("value");
      t.integer("matched");
      t.integer("total");
      t.index(["merge_commit_sha", "package", "mark"], { unique: true });
    });
    await adapter.createTable("package_file_stats", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("rails_file");
      t.string("ts_file");
      t.integer("methods_matched");
      t.integer("methods_missing");
      t.integer("tests_matched");
      t.integer("tests_total");
      t.index(["merge_commit_sha", "package", "rails_file"], { unique: true });
    });
    await adapter.createTable("package_tag_sites", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("tag");
      t.string("receipt");
      t.string("file");
      t.integer("line");
      t.string("declaration");
      t.string("cited_anchor");
    });
    await adapter.createTable("package_skip_tests", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("package");
      t.string("file");
      t.string("test_name");
      t.string("cited_anchor");
    });
    await adapter.createTable("claude_md_sections", {}, (t) => {
      t.string("merge_commit_sha");
      t.integer("pr_number");
      t.string("file");
      t.string("heading");
      t.string("anchor");
      t.text("lede");
    });
    await adapter.addColumn("sync_log", "missing_artifact", "string");
  }

  async down(): Promise<void> {
    const adapter = (await this.connection) as SQLite3Adapter;
    await adapter.removeColumn("sync_log", "missing_artifact");
    for (const table of [
      "claude_md_sections",
      "package_skip_tests",
      "package_tag_sites",
      "package_file_stats",
      "package_mark_stats",
      "package_tag_stats",
      "package_meta",
    ]) {
      await adapter.dropTable(table);
    }
  }
}
