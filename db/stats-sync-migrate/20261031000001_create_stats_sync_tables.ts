import { Migration } from "@blazetrails/activerecord";
import type { SQLite3Adapter } from "@blazetrails/activerecord/connection-adapters/sqlite3-adapter.js";

/**
 * The stats sync's whole schema, as it stands in the crontab's stats.db on
 * 2026-10-31 (every column compared; only the abandoned `pr_readmes` is absent
 * here). So an empty file gets the tables, and stats.db, adopted at cutover,
 * is recorded as migrated and left alone: `sync_log` is the sync's last table,
 * which is why it marks the schema as already there.
 */
export class CreateStatsSyncTables extends Migration.get(8) {
  async up(): Promise<void> {
    const adapter = (await this.connection) as SQLite3Adapter;
    if (await adapter.tableExists("sync_log")) return;

    await adapter.beginTransaction();
    try {
      await adapter.createTable("pull_requests", { id: false }, (t) => {
        t.integer("number", { primaryKey: true });
        t.string("title");
        t.string("author");
        t.string("branch");
        t.string("base_branch");
        t.text("body");
        t.string("created_at");
        t.string("merged_at");
        t.string("closed_at");
        t.string("merge_commit_sha");
        t.integer("additions");
        t.integer("deletions");
        t.integer("changed_files");
        t.text("labels");
        t.integer("review_count", { default: -1 });
        t.integer("comment_count", { default: -1 });
        t.integer("commit_count", { default: 0 });
        t.integer("time_open_seconds");
        t.string("review_decision");
        t.string("state", { default: "merged" });
        t.integer("is_draft", { default: 0 });
        t.integer("reviewers_synced", { default: 0 });
        t.integer("linked_issues_synced", { default: 0 });
        t.integer("timeline_synced", { default: 0 });
        t.integer("reactions_synced", { default: 0 });
      });

      await adapter.createTable("pr_files", {}, (t) => {
        t.integer("pr_number");
        t.string("filename");
        t.string("status");
        t.integer("additions");
        t.integer("deletions");
        t.integer("changes");
        t.text("patch");
        t.index(["pr_number", "filename"], { unique: true });
      });

      await adapter.createTable("pr_commits", {}, (t) => {
        t.integer("pr_number");
        t.string("sha");
        t.text("message");
        t.string("author");
        t.string("authored_at");
        t.index(["pr_number", "sha"], { unique: true });
      });

      await adapter.createTable("pr_comments", { id: false }, (t) => {
        t.integer("id", { primaryKey: true });
        t.integer("pr_number");
        t.string("author");
        t.text("body");
        t.string("created_at");
        t.string("updated_at");
        t.string("comment_type");
        t.string("path");
        t.text("diff_hunk");
        t.integer("in_reply_to_id");
        t.index(["pr_number"]);
      });

      await adapter.createTable("pr_reviews", { id: false }, (t) => {
        t.integer("id", { primaryKey: true });
        t.integer("pr_number");
        t.string("author");
        t.string("state");
        t.text("body");
        t.string("submitted_at");
        t.string("source", { default: "github" });
        t.string("source_path");
        t.index(["pr_number"]);
        t.index(["source_path"], { unique: true });
      });

      await adapter.createTable("pr_requested_reviewers", {}, (t) => {
        t.integer("pr_number");
        t.string("reviewer");
        t.string("reviewer_type");
        t.index(["pr_number", "reviewer", "reviewer_type"], { unique: true });
      });

      await adapter.createTable("pr_linked_issues", {}, (t) => {
        t.integer("pr_number");
        t.integer("issue_number");
        t.string("issue_title");
        t.string("issue_state");
        t.index(["pr_number", "issue_number"], { unique: true });
      });

      await adapter.createTable("pr_timeline_events", {}, (t) => {
        t.integer("pr_number");
        t.string("event_type");
        t.string("actor");
        t.string("created_at");
        t.string("label_name");
        t.text("body");
        t.index(["pr_number"]);
      });

      await adapter.createTable("pr_reactions", { id: false }, (t) => {
        t.integer("reaction_id", { primaryKey: true });
        t.integer("pr_number");
        t.string("user");
        t.string("content");
        t.string("created_at");
        t.index(["reaction_id"], { unique: true });
        t.index(["pr_number"]);
      });

      await adapter.createTable("workflow_runs", { id: false }, (t) => {
        t.integer("id", { primaryKey: true });
        t.string("head_sha");
        t.integer("pr_number");
        t.string("event");
        t.string("status");
        t.string("conclusion");
        t.string("created_at");
        t.string("updated_at");
        t.string("run_started_at");
        t.integer("duration_seconds");
        t.string("workflow_name");
        t.integer("run_attempt", { default: 1 });
        t.index(["head_sha"]);
      });

      await adapter.createTable("workflow_jobs", { id: false }, (t) => {
        t.integer("id", { primaryKey: true });
        t.integer("run_id");
        t.string("name");
        t.string("status");
        t.string("conclusion");
        t.string("started_at");
        t.string("completed_at");
        t.integer("duration_seconds");
        t.index(["run_id", "name"]);
      });

      await adapter.createTable("workflow_steps", {}, (t) => {
        t.integer("job_id");
        t.string("name");
        t.string("status");
        t.string("conclusion");
        t.integer("number");
        t.string("started_at");
        t.string("completed_at");
        t.integer("duration_seconds");
        t.index(["job_id", "number"], { unique: true });
      });

      await adapter.createTable("check_annotations", {}, (t) => {
        t.integer("run_id");
        t.integer("job_id");
        t.string("path");
        t.integer("start_line");
        t.integer("end_line");
        t.string("annotation_level");
        t.text("message");
        t.string("title");
        t.index(["run_id"]);
        t.index(["job_id"]);
      });

      await adapter.createTable("test_compare_stats", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("package");
        t.integer("matched");
        t.integer("total");
        t.float("percent");
        t.integer("skipped", { default: 0 });
        t.integer("files_mapped", { default: 0 });
        t.integer("files_total", { default: 0 });
        t.integer("misplaced", { default: 0 });
        t.integer("assertion_count_mismatch", { default: 0 });
        t.integer("assertion_kind_mismatch", { default: 0 });
        t.index(["merge_commit_sha", "package"], { unique: true });
      });

      await adapter.createTable("api_compare_stats", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("package");
        t.integer("matched");
        t.integer("total");
        t.float("percent");
        t.integer("misplaced", { default: 0 });
        t.integer("missing", { default: 0 });
        t.index(["merge_commit_sha", "package"], { unique: true });
      });

      await adapter.createTable("api_compare_privates_stats", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("package");
        t.integer("matched");
        t.integer("total");
        t.float("percent");
        t.integer("missing", { default: 0 });
        t.index(["merge_commit_sha", "package"], { unique: true });
      });

      await adapter.createTable("api_calls_stats", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("package");
        t.integer("matched");
        t.integer("total");
        t.float("percent");
        t.integer("mismatched", { default: 0 });
        t.index(["merge_commit_sha", "package"], { unique: true });
      });

      await adapter.createTable("api_call_args_stats", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("package");
        t.integer("matched");
        t.integer("total");
        t.float("percent");
        t.integer("mismatched", { default: 0 });
        t.index(["merge_commit_sha", "package"], { unique: true });
      });

      await adapter.createTable("compare_logs", {}, (t) => {
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.string("step_name");
        t.text("log_output");
        t.index(["merge_commit_sha", "step_name"], { unique: true });
      });

      await adapter.createTable("raw_job_logs", { id: false }, (t) => {
        t.integer("job_id", { primaryKey: true });
        t.integer("run_id");
        t.string("job_name");
        t.string("merge_commit_sha");
        t.integer("pr_number");
        t.text("log_output");
        t.index(["merge_commit_sha"]);
        t.index(["run_id"]);
      });

      await adapter.createTable("expired_job_logs", { id: false }, (t) => {
        t.integer("job_id", { primaryKey: true });
        t.string("job_name");
        t.integer("pr_number");
        t.string("checked_at");
      });

      await adapter.createTable("sync_log", {}, (t) => {
        t.string("synced_at");
        t.integer("prs_synced", { default: 0 });
        t.integer("runs_synced", { default: 0 });
        t.integer("logs_parsed", { default: 0 });
      });

      await adapter.commitTransaction();
    } catch (err) {
      await adapter.rollbackTransaction();
      throw err;
    }
  }

  /** Dropping these would destroy a stats.db this migration merely adopted. */
  async down(): Promise<void> {
    // IrreversibleMigration is not exported by the vendored activerecord.
    throw new Error("CreateStatsSyncTables is irreversible");
  }
}
