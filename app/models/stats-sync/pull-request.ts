import { StatsSyncRecord } from "./stats-sync-record.ts";

export class PullRequest extends StatsSyncRecord {
  static {
    this.tableName = "pull_requests";
    this.primaryKey = "number";
    this.attribute("number", "integer");
    this.attribute("title", "string");
    this.attribute("author", "string");
    this.attribute("branch", "string");
    this.attribute("base_branch", "string");
    this.attribute("body", "string");
    this.attribute("created_at", "string");
    this.attribute("merged_at", "string");
    this.attribute("closed_at", "string");
    this.attribute("merge_commit_sha", "string");
    this.attribute("additions", "integer");
    this.attribute("deletions", "integer");
    this.attribute("changed_files", "integer");
    this.attribute("labels", "string");
    this.attribute("review_count", "integer", { default: -1 });
    this.attribute("comment_count", "integer", { default: -1 });
    this.attribute("commit_count", "integer", { default: 0 });
    this.attribute("time_open_seconds", "integer");
    this.attribute("review_decision", "string");
    this.attribute("state", "string");
    this.attribute("is_draft", "integer");
    this.attribute("reviewers_synced", "integer", { default: 0 });
    this.attribute("linked_issues_synced", "integer", { default: 0 });
    this.attribute("timeline_synced", "integer", { default: 0 });
    this.attribute("reactions_synced", "integer", { default: 0 });
  }
}
