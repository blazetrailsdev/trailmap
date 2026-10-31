// This file is auto-generated from the current state of the database. Instead
// of editing this file, please use the migrations feature of Active Record to
// incrementally modify your database, and then regenerate this schema definition.
//
// This file is the source Trails uses to define your schema when running `bin/trails
// db:schema:load`. When creating a new database, `bin/trails db:schema:load` tends to
// be faster and is potentially less error prone than running all of your
// migrations from scratch. Old migrations may fail to apply correctly if those
// migrations use external dependencies or application code.
//
// It's strongly recommended that you check this file into your version control system.

import { Schema } from "@blazetrails/activerecord";
import type { SQLite3Adapter } from "@blazetrails/activerecord/connection-adapters/sqlite3-adapter.js";

await Schema.get(8).define<SQLite3Adapter>({ version: 2026_10_31_000001 }, async (ctx) => {
  await ctx.createTable("api_call_args_stats", { force: "cascade" }, (t) => {
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.string("package");
    t.integer("matched");
    t.integer("total");
    t.float("percent");
    t.integer("mismatched", { default: 0 });
    t.index(["merge_commit_sha", "package"], { name: "index_api_call_args_stats_on_merge_commit_sha_and_package", unique: true });
  });

  await ctx.createTable("api_calls_stats", { force: "cascade" }, (t) => {
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.string("package");
    t.integer("matched");
    t.integer("total");
    t.float("percent");
    t.integer("mismatched", { default: 0 });
    t.index(["merge_commit_sha", "package"], { name: "index_api_calls_stats_on_merge_commit_sha_and_package", unique: true });
  });

  await ctx.createTable("api_compare_privates_stats", { force: "cascade" }, (t) => {
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.string("package");
    t.integer("matched");
    t.integer("total");
    t.float("percent");
    t.integer("missing", { default: 0 });
    t.index(["merge_commit_sha", "package"], { name: "idx_on_merge_commit_sha_package_f79e5b7e56", unique: true });
  });

  await ctx.createTable("api_compare_stats", { force: "cascade" }, (t) => {
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.string("package");
    t.integer("matched");
    t.integer("total");
    t.float("percent");
    t.integer("misplaced", { default: 0 });
    t.integer("missing", { default: 0 });
    t.index(["merge_commit_sha", "package"], { name: "index_api_compare_stats_on_merge_commit_sha_and_package", unique: true });
  });

  await ctx.createTable("check_annotations", { force: "cascade" }, (t) => {
    t.integer("run_id");
    t.integer("job_id");
    t.string("path");
    t.integer("start_line");
    t.integer("end_line");
    t.string("annotation_level");
    t.text("message");
    t.string("title");
    t.index(["job_id"], { name: "index_check_annotations_on_job_id" });
    t.index(["run_id"], { name: "index_check_annotations_on_run_id" });
  });

  await ctx.createTable("compare_logs", { force: "cascade" }, (t) => {
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.string("step_name");
    t.text("log_output");
    t.index(["merge_commit_sha", "step_name"], { name: "index_compare_logs_on_merge_commit_sha_and_step_name", unique: true });
  });

  await ctx.createTable("expired_job_logs", { primaryKey: "job_id", force: "cascade" }, (t) => {
    t.string("job_name");
    t.integer("pr_number");
    t.string("checked_at");
  });

  await ctx.createTable("pr_comments", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("author");
    t.text("body");
    t.string("created_at");
    t.string("updated_at");
    t.string("comment_type");
    t.string("path");
    t.text("diff_hunk");
    t.integer("in_reply_to_id");
    t.index(["pr_number"], { name: "index_pr_comments_on_pr_number" });
  });

  await ctx.createTable("pr_commits", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("sha");
    t.text("message");
    t.string("author");
    t.string("authored_at");
    t.index(["pr_number", "sha"], { name: "index_pr_commits_on_pr_number_and_sha", unique: true });
  });

  await ctx.createTable("pr_files", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("filename");
    t.string("status");
    t.integer("additions");
    t.integer("deletions");
    t.integer("changes");
    t.text("patch");
    t.index(["pr_number", "filename"], { name: "index_pr_files_on_pr_number_and_filename", unique: true });
  });

  await ctx.createTable("pr_linked_issues", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.integer("issue_number");
    t.string("issue_title");
    t.string("issue_state");
    t.index(["pr_number", "issue_number"], { name: "index_pr_linked_issues_on_pr_number_and_issue_number", unique: true });
  });

  await ctx.createTable("pr_reactions", { primaryKey: "reaction_id", force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("user");
    t.string("content");
    t.string("created_at");
    t.index(["pr_number"], { name: "index_pr_reactions_on_pr_number" });
    t.index(["reaction_id"], { name: "index_pr_reactions_on_reaction_id", unique: true });
  });

  await ctx.createTable("pr_requested_reviewers", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("reviewer");
    t.string("reviewer_type");
    t.index(["pr_number", "reviewer", "reviewer_type"], { name: "idx_on_pr_number_reviewer_reviewer_type_f471de1c8d", unique: true });
  });

  await ctx.createTable("pr_reviews", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("author");
    t.string("state");
    t.text("body");
    t.string("submitted_at");
    t.string("source", { default: "github" });
    t.string("source_path");
    t.index(["pr_number"], { name: "index_pr_reviews_on_pr_number" });
    t.index(["source_path"], { name: "index_pr_reviews_on_source_path", unique: true });
  });

  await ctx.createTable("pr_timeline_events", { force: "cascade" }, (t) => {
    t.integer("pr_number");
    t.string("event_type");
    t.string("actor");
    t.string("created_at");
    t.string("label_name");
    t.text("body");
    t.index(["pr_number"], { name: "index_pr_timeline_events_on_pr_number" });
  });

  await ctx.createTable("pull_requests", { primaryKey: "number", force: "cascade" }, (t) => {
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

  await ctx.createTable("raw_job_logs", { primaryKey: "job_id", force: "cascade" }, (t) => {
    t.integer("run_id");
    t.string("job_name");
    t.string("merge_commit_sha");
    t.integer("pr_number");
    t.text("log_output");
    t.index(["merge_commit_sha"], { name: "index_raw_job_logs_on_merge_commit_sha" });
    t.index(["run_id"], { name: "index_raw_job_logs_on_run_id" });
  });

  await ctx.createTable("sync_log", { force: "cascade" }, (t) => {
    t.string("synced_at");
    t.integer("prs_synced", { default: 0 });
    t.integer("runs_synced", { default: 0 });
    t.integer("logs_parsed", { default: 0 });
  });

  await ctx.createTable("test_compare_stats", { force: "cascade" }, (t) => {
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
    t.index(["merge_commit_sha", "package"], { name: "index_test_compare_stats_on_merge_commit_sha_and_package", unique: true });
  });

  await ctx.createTable("workflow_jobs", { force: "cascade" }, (t) => {
    t.integer("run_id");
    t.string("name");
    t.string("status");
    t.string("conclusion");
    t.string("started_at");
    t.string("completed_at");
    t.integer("duration_seconds");
    t.index(["run_id", "name"], { name: "index_workflow_jobs_on_run_id_and_name" });
  });

  await ctx.createTable("workflow_runs", { force: "cascade" }, (t) => {
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
    t.index(["head_sha"], { name: "index_workflow_runs_on_head_sha" });
  });

  await ctx.createTable("workflow_steps", { force: "cascade" }, (t) => {
    t.integer("job_id");
    t.string("name");
    t.string("status");
    t.string("conclusion");
    t.integer("number");
    t.string("started_at");
    t.string("completed_at");
    t.integer("duration_seconds");
    t.index(["job_id", "number"], { name: "index_workflow_steps_on_job_id_and_number", unique: true });
  });
});
