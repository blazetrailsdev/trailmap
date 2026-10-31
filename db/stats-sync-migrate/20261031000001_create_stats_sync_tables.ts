import { Migration } from "@blazetrails/activerecord";
import type { SQLite3Adapter } from "@blazetrails/activerecord/connection-adapters/sqlite3-adapter.js";

async function tableExists(
  adapter: SQLite3Adapter,
  name: string,
): Promise<boolean> {
  const rows = (
    await adapter.execQuery(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      "SQL",
      [name],
    )
  ).toArray();
  return rows.length > 0;
}

async function columnExists(
  adapter: SQLite3Adapter,
  table: string,
  column: string,
): Promise<boolean> {
  const quoted = `"${table.replace(/"/g, '""')}"`;
  const cols = (
    await adapter.selectAll(`PRAGMA table_info(${quoted})`)
  ).toArray() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

/**
 * The stats sync's whole schema, imported from what used to run at the top of
 * every sync. It stays idempotent, branching on what the file already holds,
 * because it has two starting points: an empty database, and the crontab's
 * stats.db at cutover, which may carry any older shape of these tables.
 */
export class CreateStatsSyncTables extends Migration.get(8) {
  async up(): Promise<void> {
    const adapter = (await this.connection) as SQLite3Adapter;
    const hasExistingSchema = await tableExists(adapter, "sync_log");

    if (hasExistingSchema) {
      if (!(await tableExists(adapter, "compare_logs"))) {
        await adapter.createTable("compare_logs", {}, (t) => {
          t.string("merge_commit_sha");
          t.integer("pr_number");
          t.string("step_name");
          t.text("log_output");
          t.index(["merge_commit_sha", "step_name"], { unique: true });
        });
      }
      if (await tableExists(adapter, "raw_job_logs")) {
        if (
          !(await columnExists(adapter, "raw_job_logs", "run_id")) ||
          !(await columnExists(adapter, "raw_job_logs", "job_name"))
        ) {
          await adapter.execute(
            `CREATE TABLE raw_job_logs_new (
              job_id INTEGER PRIMARY KEY,
              run_id INTEGER,
              job_name TEXT,
              merge_commit_sha TEXT,
              pr_number INTEGER,
              log_output TEXT
            )`,
          );
          await adapter.execute(
            `INSERT OR IGNORE INTO raw_job_logs_new (job_id, merge_commit_sha, pr_number, log_output)
             SELECT job_id, merge_commit_sha, pr_number, log_output FROM raw_job_logs`,
          );
          await adapter.execute(`DROP TABLE raw_job_logs`);
          await adapter.execute(
            `ALTER TABLE raw_job_logs_new RENAME TO raw_job_logs`,
          );
          await adapter.execute(
            `CREATE INDEX index_raw_job_logs_on_merge_commit_sha ON raw_job_logs (merge_commit_sha)`,
          );
          await adapter.execute(
            `CREATE INDEX index_raw_job_logs_on_run_id ON raw_job_logs (run_id)`,
          );
        }
        if (await tableExists(adapter, "workflow_jobs")) {
          await adapter.execute(
            `UPDATE raw_job_logs SET
              run_id = (SELECT wj.run_id FROM workflow_jobs wj WHERE wj.id = raw_job_logs.job_id),
              job_name = (SELECT wj.name FROM workflow_jobs wj WHERE wj.id = raw_job_logs.job_id)
            WHERE run_id IS NULL OR job_name IS NULL`,
          );
        }
      } else {
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
      }

      if (await tableExists(adapter, "pull_requests")) {
        if (!(await columnExists(adapter, "pull_requests", "state"))) {
          await adapter.execute(
            `ALTER TABLE pull_requests ADD COLUMN state TEXT DEFAULT 'merged'`,
          );
        }
        if (!(await columnExists(adapter, "pull_requests", "is_draft"))) {
          await adapter.execute(
            `ALTER TABLE pull_requests ADD COLUMN is_draft INTEGER DEFAULT 0`,
          );
        }
        for (const col of [
          "reviewers_synced",
          "linked_issues_synced",
          "timeline_synced",
          "reactions_synced",
        ]) {
          if (!(await columnExists(adapter, "pull_requests", col))) {
            await adapter.execute(
              `ALTER TABLE pull_requests ADD COLUMN ${col} INTEGER DEFAULT 0`,
            );
          }
        }
      }

      if (await tableExists(adapter, "pr_reviews")) {
        if (!(await columnExists(adapter, "pr_reviews", "source"))) {
          await adapter.execute(
            `ALTER TABLE pr_reviews ADD COLUMN source TEXT DEFAULT 'github'`,
          );
        }
        if (!(await columnExists(adapter, "pr_reviews", "source_path"))) {
          await adapter.execute(
            `ALTER TABLE pr_reviews ADD COLUMN source_path TEXT`,
          );
        }
        // Match the fresh-DB schema below. NULLs (every github-sourced row) are
        // distinct under a SQLite unique index, so this only constrains the
        // source_path of local reviews.
        await adapter.execute(
          `CREATE UNIQUE INDEX IF NOT EXISTS index_pr_reviews_on_source_path ON pr_reviews (source_path)`,
        );
      }

      if (await tableExists(adapter, "workflow_runs")) {
        if (!(await columnExists(adapter, "workflow_runs", "run_attempt"))) {
          await adapter.execute(
            `ALTER TABLE workflow_runs ADD COLUMN run_attempt INTEGER DEFAULT 1`,
          );
          await adapter.execute(
            `UPDATE workflow_runs SET run_attempt = 1 WHERE run_attempt IS NULL`,
          );
        }
      }

      if (!(await tableExists(adapter, "pr_requested_reviewers"))) {
        await adapter.createTable("pr_requested_reviewers", {}, (t) => {
          t.integer("pr_number");
          t.string("reviewer");
          t.string("reviewer_type");
          t.index(["pr_number", "reviewer", "reviewer_type"], { unique: true });
        });
      }

      if (!(await tableExists(adapter, "pr_linked_issues"))) {
        await adapter.createTable("pr_linked_issues", {}, (t) => {
          t.integer("pr_number");
          t.integer("issue_number");
          t.string("issue_title");
          t.string("issue_state");
          t.index(["pr_number", "issue_number"], { unique: true });
        });
      }

      if (!(await tableExists(adapter, "pr_timeline_events"))) {
        await adapter.createTable("pr_timeline_events", {}, (t) => {
          t.integer("pr_number");
          t.string("event_type");
          t.string("actor");
          t.string("created_at");
          t.string("label_name");
          t.text("body");
          t.index(["pr_number"]);
        });
      }

      if (!(await tableExists(adapter, "pr_reactions"))) {
        await adapter.createTable("pr_reactions", { id: false }, (t) => {
          t.integer("reaction_id", { primaryKey: true });
          t.integer("pr_number");
          t.string("user");
          t.string("content");
          t.string("created_at");
          t.index(["reaction_id"], { unique: true });
          t.index(["pr_number"]);
        });
      }

      if (!(await tableExists(adapter, "check_annotations"))) {
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
      }

      if (!(await tableExists(adapter, "workflow_steps"))) {
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
      }

      for (const col of [
        "assertion_count_mismatch",
        "assertion_kind_mismatch",
      ]) {
        if (await columnExists(adapter, "test_compare_stats", col)) continue;
        await adapter.execute(
          `ALTER TABLE test_compare_stats ADD COLUMN ${col} INTEGER DEFAULT 0`,
        );
      }

      for (const table of ["api_calls_stats", "api_call_args_stats"]) {
        if (await tableExists(adapter, table)) continue;
        await adapter.createTable(table, {}, (t) => {
          t.string("merge_commit_sha");
          t.integer("pr_number");
          t.string("package");
          t.integer("matched");
          t.integer("total");
          t.float("percent");
          t.integer("mismatched", { default: 0 });
          t.index(["merge_commit_sha", "package"], { unique: true });
        });
      }

      if (!(await tableExists(adapter, "api_compare_privates_stats"))) {
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
      }

      if (!(await tableExists(adapter, "expired_job_logs"))) {
        await adapter.createTable("expired_job_logs", { id: false }, (t) => {
          t.integer("job_id", { primaryKey: true });
          t.string("job_name");
          t.integer("pr_number");
          t.string("checked_at");
        });
      }

      return;
    }

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
}
