import { env, getChildProcessAsync, getFs, getPath } from "@blazetrails/ruby-compat";
import { ApplicationRecord } from "../../app/models/application-record.ts";
import type { SQLite3Adapter } from "@blazetrails/activerecord/connection-adapters/sqlite3-adapter.js";
import { parseTestCompareFromLogs } from "./parse-test-compare.ts";
import { parseCallSummariesFromLogs } from "./parse-call-summaries.ts";
import { classifyCompareStep } from "./classify-compare-step.ts";
import { isTransientGhError } from "./gh-transient-error.ts";
import { isExpiredJobLogError } from "./expired-job-log.ts";

const REPO = "blazetrailsdev/trails";
const [REPO_OWNER, REPO_NAME] = REPO.split("/");

// Throttle gh calls to stay under GitHub's secondary rate limit (~80 req/min
// for bursty patterns). Compute requests/minute from the interval so the
// comment can't drift.
const GH_MIN_INTERVAL_MS = 500;
const GH_REQ_PER_MIN = Math.floor(60_000 / GH_MIN_INTERVAL_MS); // 120/min at 500ms
const RATE_LIMIT_RESERVE = 1000;
const BUDGET_CHECK_EVERY = 100;

async function run(command: string): Promise<string> {
  const child = await getChildProcessAsync();
  const [stdout, stderr, status] = await child.capture3!(command, { ...env }, null, "");
  if (status.status !== 0) throw new Error(`Command failed: ${command}\n${stderr}`);
  return String(stdout);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastGhCallAt = 0;
let rateLimitCooldownUntil = 0;
let ghCallCount = 0;
let lastBudgetCheckAt = 0; // ghCallCount value at last probe — prevents re-probing on the same call boundary

void GH_REQ_PER_MIN; // documented for future reference; intentionally unused

export class StatsSyncRecord extends ApplicationRecord {
  static {
    this.abstractClass = true;
  }
}

const database = env["STATS_SYNC_DB"]!;
getFs().mkdirSync(getPath().dirname(database), { recursive: true });
// The models below declare attributes as they load, which needs a connection.
await StatsSyncRecord.establishConnection({ adapter: "sqlite3", database });

let stage = "startup";

function banner(name: string) {
  stage = name;
  console.log(`\n=== ${name} ===`);
}

export function currentStage(): string {
  return stage;
}

export class RateLimitExhaustedError extends Error {
  constructor(remaining: number) {
    super(`Stopping: only ${remaining} API calls remaining (reserve: ${RATE_LIMIT_RESERVE})`);
  }
}

class JobLogFetchFailedError extends Error {
  constructor(selected: number, expired: number, failed: number) {
    super(
      `Job log fetch failed: selected ${selected} jobs and fetched 0 ` +
        `(${failed} failed, ${expired} past GitHub's retention window). ` +
        `The compare-stats feed is stalled; see the per-job warnings above.`,
    );
  }
}

async function waitForCooldownAndInterval() {
  const cooldownRemaining = rateLimitCooldownUntil - Date.now();
  if (cooldownRemaining > 0) {
    await sleep(cooldownRemaining);
  }
  const elapsed = Date.now() - lastGhCallAt;
  if (elapsed < GH_MIN_INTERVAL_MS) {
    await sleep(GH_MIN_INTERVAL_MS - elapsed);
  }
}

async function checkRateLimitBudget() {
  if (
    ghCallCount > 0 &&
    ghCallCount % BUDGET_CHECK_EVERY === 0 &&
    ghCallCount !== lastBudgetCheckAt
  ) {
    lastBudgetCheckAt = ghCallCount;
    // Route the probe through the same throttle path so it doesn't burst
    // alongside the real call that triggered it.
    await waitForCooldownAndInterval();
    let out: string;
    try {
      out = (await run("timeout 10 gh api rate_limit --jq '.rate.remaining'")).trim();
    } catch (err) {
      console.warn(`  [budget check] probe failed: ${err instanceof Error ? err.message : err}`);
      return;
    } finally {
      lastGhCallAt = Date.now();
    }
    const remaining = parseInt(out, 10);
    if (Number.isNaN(remaining)) {
      console.warn(`  [budget check] unparseable response: ${JSON.stringify(out)}`);
      return;
    }
    if (remaining <= RATE_LIMIT_RESERVE) {
      throw new RateLimitExhaustedError(remaining);
    }
    console.log(`  [budget check] ${remaining} API calls remaining`);
  }
}

// Set when a rate-limit error fires; subsequent gh() calls block at the top
// of the loop until this time passes. Outlives a single gh() invocation so
// later calls inherit the cooldown without re-tripping the limit.
async function gh(args: string): Promise<string> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    ghCallCount++;
    await checkRateLimitBudget();
    await waitForCooldownAndInterval();
    try {
      const result = await run(`gh ${args}`);
      lastGhCallAt = Date.now();
      return result;
    } catch (err) {
      lastGhCallAt = Date.now();
      const msg = err instanceof Error ? err.message : String(err);
      if (/rate limit|secondary rate|abuse detection/i.test(msg) && attempt < MAX_RETRIES) {
        const backoffMs = Math.min(120_000, 5_000 * Math.pow(2, attempt));
        rateLimitCooldownUntil = Date.now() + backoffMs;
        console.warn(
          `  Rate limited, cooling down ${backoffMs / 1000}s (retry ${attempt + 1}/${MAX_RETRIES})...`,
        );
        continue;
      }
      if (isTransientGhError(msg) && attempt < MAX_RETRIES) {
        const backoffMs = Math.min(30_000, 2_000 * Math.pow(2, attempt));
        rateLimitCooldownUntil = Date.now() + backoffMs;
        console.warn(
          `  Transient gh transport error, retrying in ${backoffMs / 1000}s ` +
            `(retry ${attempt + 1}/${MAX_RETRIES}): ${msg.split("\n")[0]}`,
        );
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function ghJson<T>(args: string): Promise<T> {
  return JSON.parse(await gh(args)) as T;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

class PullRequest extends StatsSyncRecord {
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

class PrFile extends StatsSyncRecord {
  static {
    this.tableName = "pr_files";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("filename", "string");
    this.attribute("status", "string");
    this.attribute("additions", "integer");
    this.attribute("deletions", "integer");
    this.attribute("changes", "integer");
    this.attribute("patch", "string");
  }
}

class PrCommit extends StatsSyncRecord {
  static {
    this.tableName = "pr_commits";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("sha", "string");
    this.attribute("message", "string");
    this.attribute("author", "string");
    this.attribute("authored_at", "string");
  }
}

class PrComment extends StatsSyncRecord {
  static {
    this.tableName = "pr_comments";
    // GitHub IDs exceed 2^31 — must be bigint, not 32-bit integer.
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("author", "string");
    this.attribute("body", "string");
    this.attribute("created_at", "string");
    this.attribute("updated_at", "string");
    this.attribute("comment_type", "string");
    this.attribute("path", "string");
    this.attribute("diff_hunk", "string");
    this.attribute("in_reply_to_id", "big_integer");
  }
}

class PrReview extends StatsSyncRecord {
  static {
    this.tableName = "pr_reviews";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("author", "string");
    this.attribute("state", "string");
    this.attribute("body", "string");
    this.attribute("submitted_at", "string");
    this.attribute("source", "string");
    this.attribute("source_path", "string");
  }
}

class PrRequestedReviewer extends StatsSyncRecord {
  static {
    this.tableName = "pr_requested_reviewers";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("reviewer", "string");
    this.attribute("reviewer_type", "string");
  }
}

class PrLinkedIssue extends StatsSyncRecord {
  static {
    this.tableName = "pr_linked_issues";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("issue_number", "integer");
    this.attribute("issue_title", "string");
    this.attribute("issue_state", "string");
  }
}

class PrTimelineEvent extends StatsSyncRecord {
  static {
    this.tableName = "pr_timeline_events";
    this.attribute("id", "big_integer");
    this.attribute("pr_number", "integer");
    this.attribute("event_type", "string");
    this.attribute("actor", "string");
    this.attribute("created_at", "string");
    this.attribute("label_name", "string");
    this.attribute("body", "string");
  }
}

// Retained for the reactions sync #2433 removed: the pr_reactions table is still
// created and counted, and this is its only typed accessor.
// eslint-disable-next-line unused-imports/no-unused-vars
class PrReaction extends StatsSyncRecord {
  static {
    this.tableName = "pr_reactions";
    this.primaryKey = "reaction_id";
    this.attribute("pr_number", "integer");
    this.attribute("reaction_id", "big_integer");
    this.attribute("user", "string");
    this.attribute("content", "string");
    this.attribute("created_at", "string");
  }
}

class WorkflowRun extends StatsSyncRecord {
  static {
    this.tableName = "workflow_runs";
    this.attribute("id", "big_integer");
    this.attribute("head_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("event", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("created_at", "string");
    this.attribute("updated_at", "string");
    this.attribute("run_started_at", "string");
    this.attribute("duration_seconds", "integer");
    this.attribute("workflow_name", "string");
    this.attribute("run_attempt", "integer");
  }
}

class WorkflowJob extends StatsSyncRecord {
  static {
    this.tableName = "workflow_jobs";
    this.attribute("id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("name", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("started_at", "string");
    this.attribute("completed_at", "string");
    this.attribute("duration_seconds", "integer");
  }
}

class WorkflowStep extends StatsSyncRecord {
  static {
    this.tableName = "workflow_steps";
    this.attribute("id", "big_integer");
    this.attribute("job_id", "big_integer");
    this.attribute("name", "string");
    this.attribute("status", "string");
    this.attribute("conclusion", "string");
    this.attribute("number", "integer");
    this.attribute("started_at", "string");
    this.attribute("completed_at", "string");
    this.attribute("duration_seconds", "integer");
  }
}

class CheckAnnotation extends StatsSyncRecord {
  static {
    this.tableName = "check_annotations";
    this.attribute("id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("job_id", "big_integer");
    this.attribute("path", "string");
    this.attribute("start_line", "integer");
    this.attribute("end_line", "integer");
    this.attribute("annotation_level", "string");
    this.attribute("message", "string");
    this.attribute("title", "string");
  }
}

class TestCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "test_compare_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("skipped", "integer", { default: 0 });
    this.attribute("files_mapped", "integer", { default: 0 });
    this.attribute("files_total", "integer", { default: 0 });
    this.attribute("misplaced", "integer", { default: 0 });
    this.attribute("assertion_count_mismatch", "integer", { default: 0 });
    this.attribute("assertion_kind_mismatch", "integer", { default: 0 });
  }
}

class ApiCompareStat extends StatsSyncRecord {
  static {
    this.tableName = "api_compare_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("misplaced", "integer", { default: 0 });
    this.attribute("missing", "integer", { default: 0 });
  }
}

class ApiComparePrivatesStat extends StatsSyncRecord {
  static {
    this.tableName = "api_compare_privates_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("missing", "integer", { default: 0 });
  }
}

// The two advisory call summaries the --calls run prints. Whole-repo totals, so
// every row is package "all" — kept as a column anyway so these tables have the
// same shape as the other stats tables (and so a future per-package breakdown
// slots in without a migration).
class ApiCallsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_calls_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("mismatched", "integer", { default: 0 });
  }
}

class ApiCallArgsStat extends StatsSyncRecord {
  static {
    this.tableName = "api_call_args_stats";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("package", "string");
    this.attribute("matched", "integer");
    this.attribute("total", "integer");
    this.attribute("percent", "float");
    this.attribute("mismatched", "integer", { default: 0 });
  }
}

class CompareLog extends StatsSyncRecord {
  static {
    this.tableName = "compare_logs";
    this.attribute("id", "big_integer");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("step_name", "string");
    this.attribute("log_output", "string");
  }
}

class RawJobLog extends StatsSyncRecord {
  static {
    this.tableName = "raw_job_logs";
    this.primaryKey = "job_id";
    this.attribute("job_id", "big_integer");
    this.attribute("run_id", "big_integer");
    this.attribute("job_name", "string");
    this.attribute("merge_commit_sha", "string");
    this.attribute("pr_number", "integer");
    this.attribute("log_output", "text");
  }
}

class ExpiredJobLog extends StatsSyncRecord {
  static {
    this.tableName = "expired_job_logs";
    this.primaryKey = "job_id";
    this.attribute("job_id", "big_integer");
    this.attribute("job_name", "string");
    this.attribute("pr_number", "integer");
    this.attribute("checked_at", "string");
  }
}

class SyncLog extends StatsSyncRecord {
  static {
    this.tableName = "sync_log";
    this.attribute("id", "big_integer");
    this.attribute("synced_at", "string");
    this.attribute("prs_synced", "integer", { default: 0 });
    this.attribute("runs_synced", "integer", { default: 0 });
    this.attribute("logs_parsed", "integer", { default: 0 });
  }
}

// ---------------------------------------------------------------------------
// Schema setup via the adapter schema DSL
// ---------------------------------------------------------------------------

async function tableExists(adapter: SQLite3Adapter, name: string): Promise<boolean> {
  const rows = (
    await adapter.execQuery(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, "SQL", [
      name,
    ])
  ).toArray();
  return rows.length > 0;
}

async function columnExists(
  adapter: SQLite3Adapter,
  table: string,
  column: string,
): Promise<boolean> {
  const quoted = `"${table.replace(/"/g, '""')}"`;
  const cols = (await adapter.selectAll(`PRAGMA table_info(${quoted})`)).toArray() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

async function migrateDb(adapter: SQLite3Adapter) {
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
        await adapter.execute(`ALTER TABLE raw_job_logs_new RENAME TO raw_job_logs`);
        await adapter.execute(
          `CREATE INDEX index_raw_job_logs_on_merge_commit_sha ON raw_job_logs (merge_commit_sha)`,
        );
        await adapter.execute(`CREATE INDEX index_raw_job_logs_on_run_id ON raw_job_logs (run_id)`);
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
        await adapter.execute(`ALTER TABLE pull_requests ADD COLUMN state TEXT DEFAULT 'merged'`);
      }
      if (!(await columnExists(adapter, "pull_requests", "is_draft"))) {
        await adapter.execute(`ALTER TABLE pull_requests ADD COLUMN is_draft INTEGER DEFAULT 0`);
      }
      for (const col of [
        "reviewers_synced",
        "linked_issues_synced",
        "timeline_synced",
        "reactions_synced",
      ]) {
        if (!(await columnExists(adapter, "pull_requests", col))) {
          await adapter.execute(`ALTER TABLE pull_requests ADD COLUMN ${col} INTEGER DEFAULT 0`);
        }
      }
    }

    if (await tableExists(adapter, "pr_reviews")) {
      if (!(await columnExists(adapter, "pr_reviews", "source"))) {
        await adapter.execute(`ALTER TABLE pr_reviews ADD COLUMN source TEXT DEFAULT 'github'`);
      }
      if (!(await columnExists(adapter, "pr_reviews", "source_path"))) {
        await adapter.execute(`ALTER TABLE pr_reviews ADD COLUMN source_path TEXT`);
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
        await adapter.execute(`ALTER TABLE workflow_runs ADD COLUMN run_attempt INTEGER DEFAULT 1`);
        await adapter.execute(`UPDATE workflow_runs SET run_attempt = 1 WHERE run_attempt IS NULL`);
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

    for (const col of ["assertion_count_mismatch", "assertion_kind_mismatch"]) {
      if (await columnExists(adapter, "test_compare_stats", col)) continue;
      await adapter.execute(`ALTER TABLE test_compare_stats ADD COLUMN ${col} INTEGER DEFAULT 0`);
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

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

interface GhPrData {
  number: number;
  title: string;
  author: { login: string } | null;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  mergeCommit: { oid: string } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: { name: string }[];
  headRefName: string;
  baseRefName: string;
  body: string;
  reviewDecision: string | null;
  isDraft: boolean;
}

interface GhPrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GhPrCommit {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
}

interface GhIssueComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  updated_at: string;
}

interface GhReviewComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  updated_at: string;
  path: string;
  diff_hunk: string;
  in_reply_to_id?: number;
}

interface GhReview {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string | null;
  submitted_at: string;
}

interface GhRequestedReviewers {
  users: { login: string }[];
  teams: { slug: string }[];
}

interface GhTimelineEvent {
  event: string;
  actor?: { login: string } | null;
  created_at?: string;
  label?: { name: string };
  body?: string;
}

// Shape of the GitHub reactions payload the #2433-removed sync consumed; kept
// alongside PrReaction so restoring that sync does not have to re-derive it.
// eslint-disable-next-line unused-imports/no-unused-vars
interface GhReactionData {
  id: number;
  user: { login: string } | null;
  content: string;
  created_at: string;
}

interface GhCheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  message: string;
  title: string | null;
}

interface GhWorkflowRun {
  id: number;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at: string;
  name: string;
  run_attempt: number;
}

interface GhWorkflowJobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at: string | null;
  completed_at: string | null;
}

interface GhWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at: string;
  steps?: GhWorkflowJobStep[];
}

// ---------------------------------------------------------------------------
// Sync functions
// ---------------------------------------------------------------------------

const PR_FIELDS = [
  "number",
  "title",
  "author",
  "createdAt",
  "mergedAt",
  "closedAt",
  "mergeCommit",
  "additions",
  "deletions",
  "changedFiles",
  "labels",
  "headRefName",
  "baseRefName",
  "body",
  "reviewDecision",
  "isDraft",
].join(",");

function mapPr(pr: GhPrData) {
  const endDate = pr.mergedAt ?? pr.closedAt;
  const timeOpenMs =
    endDate && pr.createdAt ? new Date(endDate).getTime() - new Date(pr.createdAt).getTime() : null;
  return {
    number: pr.number,
    title: pr.title,
    author: pr.author?.login ?? null,
    branch: pr.headRefName,
    base_branch: pr.baseRefName,
    body: pr.body,
    created_at: pr.createdAt,
    merged_at: pr.mergedAt,
    closed_at: pr.closedAt,
    merge_commit_sha: pr.mergeCommit?.oid ?? null,
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changedFiles,
    labels: JSON.stringify(pr.labels.map((l) => l.name)),
    review_count: -1,
    comment_count: -1,
    commit_count: 0,
    time_open_seconds: timeOpenMs !== null ? Math.round(timeOpenMs / 1000) : null,
    review_decision: pr.reviewDecision ?? null,
    state: pr.mergedAt ? "merged" : pr.closedAt ? "closed" : "open",
    is_draft: pr.isDraft ? 1 : 0,
  };
}




async function syncPullRequests(mode: "latest" | "refresh"): Promise<number> {
  const rows = await PullRequest.findBySql("SELECT MAX(number) as number FROM pull_requests");
  const lastSynced = (rows[0]?.readAttribute("number") as number) ?? 0;
  console.log(`Last synced PR: #${lastSynced}`);

  const fields = PR_FIELDS;

  const limit = mode === "latest" ? 1000 : 5000;
  const allPrs = await ghJson<GhPrData[]>(
    `pr list --repo ${REPO} --state all --limit ${limit} --json ${fields} --jq '[.[] | select(.number > ${lastSynced})]'`,
  );

  console.log(`Found ${allPrs.length} new PRs to sync`);

  if (allPrs.length > 0) {
    await PullRequest.upsertAll(allPrs.map(mapPr), { uniqueBy: "number" });
  }

  if (mode === "refresh") {
    const staleCount = (
      await (
        await StatsSyncRecord.leaseConnection()
      ).selectAll(`SELECT COUNT(*) as cnt FROM pull_requests WHERE state IS NULL`)
    ).toArray();
    const cnt = (staleCount[0] as { cnt: number }).cnt;
    if (cnt > 0) {
      console.log(`Backfilling state for ${cnt} existing PRs from merged_at/closed_at...`);
      await (
        await StatsSyncRecord.leaseConnection()
      ).execute(
        `UPDATE pull_requests SET state = CASE
          WHEN merged_at IS NOT NULL THEN 'merged'
          WHEN closed_at IS NOT NULL THEN 'closed'
          ELSE 'open'
        END WHERE state IS NULL`,
      );
      await (
        await StatsSyncRecord.leaseConnection()
      ).execute(`UPDATE pull_requests SET is_draft = 0 WHERE is_draft IS NULL`);
    }
  }

  const openRows = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE state = 'open' OR state IS NULL ORDER BY number DESC`,
  );
  if (openRows.length > 0) {
    console.log(`Re-fetching ${openRows.length} open PRs to check for state changes...`);
    for (const row of openRows) {
      const num = row.readAttribute("number") as number;
      try {
        const pr = await ghJson<GhPrData>(`pr view ${num} --repo ${REPO} --json ${fields}`);
        await PullRequest.upsertAll([mapPr(pr)], { uniqueBy: "number" });
      } catch (err) {
        if (err instanceof RateLimitExhaustedError) throw err;
        console.warn(`  Failed to refresh PR #${num}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  return allPrs.length;
}

async function syncPrFiles() {
  const prsToSync = await PullRequest.findBySql(`
    SELECT p.number, p.changed_files FROM pull_requests p
    LEFT JOIN (SELECT pr_number, COUNT(*) as cnt FROM pr_files GROUP BY pr_number) f
      ON f.pr_number = p.number
    WHERE f.cnt IS NULL OR f.cnt != p.changed_files
    ORDER BY p.number
  `);

  if (prsToSync.length === 0) return;
  console.log(`Fetching file details for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    try {
      const files = await ghJson<GhPrFile[]>(`api repos/${REPO}/pulls/${number}/files --paginate`);
      await (
        await PrFile.leaseConnection()
      ).execDelete(`DELETE FROM pr_files WHERE pr_number = ?`, null, [number]);
      if (files.length > 0) {
        await PrFile.insertAll(
          files.map((f) => ({
            pr_number: number,
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes,
            patch: f.patch ?? null,
          })),
        );
      }
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch files for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncPrCommits() {
  const prsToSync = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE commit_count = 0 ORDER BY number`,
  );

  if (prsToSync.length === 0) return;
  console.log(`Fetching commits for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    try {
      const commits = await ghJson<GhPrCommit[]>(`api repos/${REPO}/pulls/${number}/commits --paginate`);
      await (
        await PrCommit.leaseConnection()
      ).execDelete(`DELETE FROM pr_commits WHERE pr_number = ?`, null, [number]);
      if (commits.length > 0) {
        await PrCommit.insertAll(
          commits.map((c) => ({
            pr_number: number,
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author.name,
            authored_at: c.commit.author.date,
          })),
        );
      }
      await PullRequest.where({ number }).updateAll({ commit_count: commits.length });
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch commits for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncPrComments() {
  const prsToSync = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE review_count = -1 ORDER BY number`,
  );

  if (prsToSync.length === 0) return;
  console.log(`Fetching comments for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    let totalComments = 0;
    try {
      const issueComments = await ghJson<GhIssueComment[]>(
        `api repos/${REPO}/issues/${number}/comments --paginate`,
      );
      if (issueComments.length > 0) {
        await PrComment.upsertAll(
          issueComments.map((c) => ({
            id: c.id,
            pr_number: number,
            author: c.user?.login ?? null,
            body: c.body,
            created_at: c.created_at,
            updated_at: c.updated_at,
            comment_type: "issue",
            path: null,
            diff_hunk: null,
            in_reply_to_id: null,
          })),
          { uniqueBy: "id" },
        );
      }
      totalComments += issueComments.length;

      const reviewComments = await ghJson<GhReviewComment[]>(
        `api repos/${REPO}/pulls/${number}/comments --paginate`,
      );
      if (reviewComments.length > 0) {
        await PrComment.upsertAll(
          reviewComments.map((c) => ({
            id: c.id,
            pr_number: number,
            author: c.user?.login ?? null,
            body: c.body,
            created_at: c.created_at,
            updated_at: c.updated_at,
            comment_type: "review",
            path: c.path,
            diff_hunk: c.diff_hunk,
            in_reply_to_id: c.in_reply_to_id ?? null,
          })),
          { uniqueBy: "id" },
        );
      }
      totalComments += reviewComments.length;

      const reviews = await ghJson<GhReview[]>(`api repos/${REPO}/pulls/${number}/reviews --paginate`);
      if (reviews.length > 0) {
        await PrReview.upsertAll(
          reviews.map((r) => ({
            id: r.id,
            pr_number: number,
            author: r.user?.login ?? null,
            state: r.state,
            body: r.body,
            submitted_at: r.submitted_at,
          })),
          { uniqueBy: "id" },
        );
      }

      await PullRequest.where({ number }).updateAll({
        comment_count: totalComments,
        review_count: reviews.length,
      });
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch comments for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// Stable, deterministic, collision-free synthetic id for a filesystem-sourced
// review. GitHub review ids are positive, so we return a NEGATIVE 52-bit value
// (within Number.MAX_SAFE_INTEGER) derived from the path — re-ingesting the same
// file upserts the same row by id rather than duplicating it.

// Reviews delivered via the /review-pr skill live only on the filesystem (see
// BTWHOOKS_REVIEWS_DIR) — they're never posted to GitHub, so the API-driven
// syncPrComments above misses them. Scan the btwhooks tree and upsert them into
// pr_reviews. Pure filesystem + DB; no GitHub API, so no rate-limit concerns.
//
// We deliberately do NOT touch pull_requests.review_count here: that column is
// the syncPrComments fetch sentinel (-1 = needs fetch) and reflects the GitHub
// review count only. Aggregate over pr_reviews rows when a local-inclusive count
// is needed.

async function syncPrRequestedReviewers() {
  const prsToSync = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE reviewers_synced = 0 ORDER BY number`,
  );

  if (prsToSync.length === 0) return;
  console.log(`Fetching requested reviewers for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    try {
      const resp = await ghJson<GhRequestedReviewers>(
        `api repos/${REPO}/pulls/${number}/requested_reviewers`,
      );
      const records: { pr_number: number; reviewer: string; reviewer_type: string }[] = [];
      for (const user of resp.users) {
        records.push({ pr_number: number, reviewer: user.login, reviewer_type: "user" });
      }
      for (const team of resp.teams) {
        records.push({ pr_number: number, reviewer: team.slug, reviewer_type: "team" });
      }
      if (records.length > 0) {
        await PrRequestedReviewer.upsertAll(records, {
          uniqueBy: ["pr_number", "reviewer", "reviewer_type"],
        });
      }
      await PullRequest.where({ number }).updateAll({ reviewers_synced: 1 });
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch requested reviewers for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncPrLinkedIssues() {
  const prsToSync = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE linked_issues_synced = 0 ORDER BY number`,
  );

  if (prsToSync.length === 0) return;
  console.log(`Fetching linked issues for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    try {
      const nodes: { number: number; title: string; state: string }[] = [];
      let after: string | null = null;
      let hasNextPage = false;
      do {
        const afterArg: string = after ? `, after:"${after}"` : "";
        const resp = await ghJson<{
          data: {
            repository: {
              pullRequest: {
                closingIssuesReferences: {
                  nodes: { number: number; title: string; state: string }[];
                  pageInfo: { hasNextPage: boolean; endCursor: string | null };
                };
              };
            };
          };
        }>(
          `api graphql -f query='{ repository(owner:"${REPO_OWNER}", name:"${REPO_NAME}") { pullRequest(number: ${number}) { closingIssuesReferences(first:50${afterArg}) { nodes { number title state } pageInfo { hasNextPage endCursor } } } } }'`,
        );
        const connection = resp.data.repository.pullRequest.closingIssuesReferences;
        nodes.push(...connection.nodes);
        hasNextPage = connection.pageInfo.hasNextPage;
        after = connection.pageInfo.endCursor;
      } while (hasNextPage);

      if (nodes.length > 0) {
        await PrLinkedIssue.upsertAll(
          nodes.map((n) => ({
            pr_number: number,
            issue_number: n.number,
            issue_title: n.title,
            issue_state: n.state,
          })),
          { uniqueBy: ["pr_number", "issue_number"] },
        );
      }
      await PullRequest.where({ number }).updateAll({ linked_issues_synced: 1 });
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch linked issues for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncPrTimelineEvents() {
  const prsToSync = await PullRequest.findBySql(
    `SELECT number FROM pull_requests WHERE timeline_synced = 0 ORDER BY number`,
  );

  if (prsToSync.length === 0) return;
  console.log(`Fetching timeline events for ${prsToSync.length} PRs...`);

  for (const pr of prsToSync) {
    const number = pr.readAttribute("number") as number;
    try {
      const events = await ghJson<GhTimelineEvent[]>(
        `api repos/${REPO}/issues/${number}/timeline --paginate`,
      );
      await (
        await PrTimelineEvent.leaseConnection()
      ).execDelete(`DELETE FROM pr_timeline_events WHERE pr_number = ?`, null, [number]);
      if (events.length > 0) {
        await PrTimelineEvent.insertAll(
          events.map((e) => ({
            pr_number: number,
            event_type: e.event,
            actor: e.actor?.login ?? null,
            created_at: e.created_at ?? null,
            label_name: e.label?.name ?? null,
            body: e.body ?? null,
          })),
        );
      }
      await PullRequest.where({ number }).updateAll({ timeline_synced: 1 });
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch timeline events for PR #${number}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncPrReactions() {
  // Skipped — no reactions on this repo, not worth the API calls. If reactions
  // become relevant, restore the prior implementation from git history
  // (#2433 removed it) and let the `reactions_synced=0` rows backfill.
}

async function syncWorkflowRuns(mode: "latest" | "refresh" | "backfill"): Promise<number> {
  const limitClause = mode === "latest" ? "LIMIT 50" : "";
  const missingRuns = await PullRequest.findBySql(`
    SELECT DISTINCT merge_commit_sha, number FROM pull_requests
    WHERE merge_commit_sha IS NOT NULL
    AND (
      merge_commit_sha NOT IN (SELECT head_sha FROM workflow_runs)
      OR EXISTS (
        SELECT 1 FROM workflow_runs wr
        LEFT JOIN workflow_jobs wj ON wj.run_id = wr.id
        WHERE wr.head_sha = pull_requests.merge_commit_sha
        GROUP BY wr.id HAVING COUNT(wj.id) = 0
      )
    )
    ORDER BY number DESC
    ${limitClause}
  `);

  if (missingRuns.length === 0) {
    console.log("All workflow runs already synced");
    return 0;
  }

  console.log(`Fetching workflow runs for ${missingRuns.length} merge commits...`);
  let synced = 0;

  for (const row of missingRuns) {
    const sha = row.readAttribute("merge_commit_sha") as string;
    const number = row.readAttribute("number") as number;
    try {
      const resp = await ghJson<{ workflow_runs: GhWorkflowRun[] }>(
        `api repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100`,
      );

      for (const run of resp.workflow_runs) {
        const duration =
          run.run_started_at && run.updated_at
            ? Math.round(
                (new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) /
                  1000,
              )
            : null;

        await WorkflowRun.upsertAll(
          [
            {
              id: run.id,
              head_sha: run.head_sha,
              pr_number: number,
              event: run.event,
              status: run.status,
              conclusion: run.conclusion,
              created_at: run.created_at,
              updated_at: run.updated_at,
              run_started_at: run.run_started_at,
              duration_seconds: duration,
              workflow_name: run.name,
              run_attempt: run.run_attempt,
            },
          ],
          { uniqueBy: "id" },
        );

        const jobsResp = await ghJson<{ jobs: GhWorkflowJob[] }>(
          `api repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100`,
        );

        if (jobsResp.jobs.length > 0) {
          await WorkflowJob.upsertAll(
            jobsResp.jobs.map((job) => {
              const jobDuration =
                job.started_at && job.completed_at
                  ? Math.round(
                      (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) /
                        1000,
                    )
                  : null;
              return {
                id: job.id,
                run_id: run.id,
                name: job.name,
                status: job.status,
                conclusion: job.conclusion,
                started_at: job.started_at,
                completed_at: job.completed_at,
                duration_seconds: jobDuration,
              };
            }),
            { uniqueBy: "id" },
          );

          for (const job of jobsResp.jobs) {
            if (job.steps && job.steps.length > 0) {
              await WorkflowStep.upsertAll(
                job.steps.map((step) => {
                  const stepDuration =
                    step.started_at && step.completed_at
                      ? Math.round(
                          (new Date(step.completed_at).getTime() -
                            new Date(step.started_at).getTime()) /
                            1000,
                        )
                      : null;
                  return {
                    job_id: job.id,
                    name: step.name,
                    status: step.status,
                    conclusion: step.conclusion,
                    number: step.number,
                    started_at: step.started_at,
                    completed_at: step.completed_at,
                    duration_seconds: stepDuration,
                  };
                }),
                { uniqueBy: ["job_id", "number"] },
              );
            }
          }
        }

        synced++;
      }
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch workflow runs for PR #${number} (${sha}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return synced;
}

// ---------------------------------------------------------------------------
// CI log parsing
// ---------------------------------------------------------------------------

function extractStepLogs(rawLog: string): Map<string, string> {
  const steps = new Map<string, string>();

  // Collect ALL ##[group] positions as step boundaries (not just "Run" groups).
  // This prevents the last comparison step from including post-job cleanup noise.
  const allGroups: number[] = [];
  const groupPattern = /##\[group\]/g;
  let gm;
  while ((gm = groupPattern.exec(rawLog)) !== null) {
    allGroups.push(gm.index);
  }

  // Find comparison steps by matching "##[group]Run <command>"
  const runPattern = /##\[group\]Run (.+)/g;
  let m;
  while ((m = runPattern.exec(rawLog)) !== null) {
    const command = m[1].trim();
    const stepName = classifyCompareStep(command);

    if (!stepName) continue;

    // End boundary is the next ##[group] (any kind), not just the next "Run".
    // For the last step, fall back to "Post job cleanup." as the boundary.
    const stepStart = m.index;
    const nextGroup = allGroups.find((pos) => pos > stepStart);
    let stepEnd: number;
    if (nextGroup) {
      stepEnd = nextGroup;
    } else {
      const cleanupIdx = rawLog.indexOf("Post job cleanup.", stepStart);
      stepEnd = cleanupIdx !== -1 ? cleanupIdx : rawLog.length;
    }
    const stepContent = rawLog.slice(stepStart, stepEnd);

    const cleaned = stepContent
      .split("\n")
      .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ""))
      .join("\n")
      .trim();

    steps.set(stepName, cleaned);
  }

  return steps;
}

function parseApiCompareFromLogs(logs: string) {
  const results = new Map<
    string,
    {
      matched: number;
      total: number;
      percent: number;
      misplaced: number;
      missing: number;
    }
  >();

  // Match new method-centric format: "  arel  —  335/442 methods (75.8%)  |  files: 50/80"
  const reNew = /\s{2}(\w+)\s+—\s+(\d+)\/(\d+) methods \(([\d.]+)%\)\s+\|\s+files: (\d+)\/(\d+)/g;
  // Also match old format for parsing historical CI logs
  const reOld =
    /\s{2}(\w+)\s+—\s+(\d+)\/(\d+) classes\/modules \(([\d.]+)%\)\s+\|\s+(\d+) misplaced\s+\|\s+(\d+) missing/g;

  let m;
  while ((m = reNew.exec(logs)) !== null) {
    if (m[1] === "Overall") continue;
    results.set(m[1], {
      matched: parseInt(m[2]),
      total: parseInt(m[3]),
      percent: parseFloat(m[4]),
      misplaced: 0,
      missing: parseInt(m[3]) - parseInt(m[2]),
    });
  }
  // Fall back to old format if no new-format matches found
  if (results.size === 0) {
    while ((m = reOld.exec(logs)) !== null) {
      if (m[1] === "Overall") continue;
      results.set(m[1], {
        matched: parseInt(m[2]),
        total: parseInt(m[3]),
        percent: parseFloat(m[4]),
        misplaced: parseInt(m[5]),
        missing: parseInt(m[6]),
      });
    }
  }
  // Fall back to earliest format: "  arel: 100% (152/152)"
  // Use [a-z] to match only lowercase package names, skipping PascalCase class-level lines
  if (results.size === 0) {
    const reEarliest = / {2}([a-z]\w*): ([\d.]+)% \((\d+)\/(\d+)\)/g;
    while ((m = reEarliest.exec(logs)) !== null) {
      if (m[1] === "Overall") continue;
      results.set(m[1], {
        matched: parseInt(m[3]),
        total: parseInt(m[4]),
        percent: parseFloat(m[2]),
        misplaced: 0,
        missing: parseInt(m[4]) - parseInt(m[3]),
      });
    }
  }
  return results;
}

async function syncCheckAnnotations(mode: "latest" | "refresh" | "backfill") {
  const limitClause = mode === "latest" ? "LIMIT 50" : "";
  const jobsToSync = (
    await (
      await StatsSyncRecord.leaseConnection()
    ).selectAll(`
    SELECT wj.id as job_id, wr.id as run_id
    FROM workflow_jobs wj
    JOIN workflow_runs wr ON wr.id = wj.run_id
    WHERE wj.conclusion IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM check_annotations ca WHERE ca.job_id = wj.id
    )
    ORDER BY wr.pr_number DESC, wj.id
    ${limitClause}
  `)
  ).toArray();

  if (jobsToSync.length === 0) return;
  console.log(`Backfilling annotations for ${jobsToSync.length} jobs...`);

  for (const row of jobsToSync) {
    const jobId = row.job_id as number;
    const runId = row.run_id as number;
    try {
      const annotations = await ghJson<GhCheckAnnotation[]>(
        `api repos/${REPO}/check-runs/${jobId}/annotations --paginate`,
      );
      await (
        await CheckAnnotation.leaseConnection()
      ).execDelete(`DELETE FROM check_annotations WHERE job_id = ?`, null, [jobId]);
      if (annotations.length > 0) {
        await CheckAnnotation.insertAll(
          annotations.map((a) => ({
            run_id: runId,
            job_id: jobId,
            path: a.path,
            start_line: a.start_line,
            end_line: a.end_line,
            annotation_level: a.annotation_level,
            message: a.message,
            title: a.title ?? null,
          })),
        );
      }
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      console.warn(
        `  Failed to fetch annotations for job ${jobId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

async function syncJobLogs(mode: "latest" | "refresh" | "backfill"): Promise<number> {
  const limitClause = mode === "latest" ? "LIMIT 50" : "";
  const jobsToFetch = (
    await (
      await StatsSyncRecord.leaseConnection()
    ).selectAll(`
    SELECT wj.id as job_id, wj.run_id, wj.name as job_name,
           wr.head_sha, wr.pr_number
    FROM workflow_jobs wj
    JOIN workflow_runs wr ON wr.id = wj.run_id
    WHERE wj.conclusion IS NOT NULL
    AND wj.name = 'Rails API/Test Comparison'
    AND NOT EXISTS (
      SELECT 1 FROM raw_job_logs rjl WHERE rjl.job_id = wj.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM expired_job_logs ejl WHERE ejl.job_id = wj.id
    )
    ORDER BY wr.pr_number DESC, wj.run_id, wj.id
    ${limitClause}
  `)
  ).toArray();

  if (jobsToFetch.length === 0) {
    console.log("All job logs already synced");
    return 0;
  }

  console.log(`Fetching logs for ${jobsToFetch.length} jobs...`);
  let fetched = 0;
  let expired = 0;
  let failed = 0;

  for (const job of jobsToFetch) {
    const jobId = job.job_id as number;
    const runId = job.run_id as number;
    const jobName = job.job_name as string;
    const headSha = job.head_sha as string;
    const prNumber = job.pr_number as number;

    try {
      const logs = await gh(`api --allow-escape-sequences repos/${REPO}/actions/jobs/${jobId}/logs`);
      await RawJobLog.upsertAll(
        [
          {
            job_id: jobId,
            run_id: runId,
            job_name: jobName,
            merge_commit_sha: headSha,
            pr_number: prNumber,
            log_output: logs,
          },
        ],
        { uniqueBy: "job_id" },
      );
      fetched++;
      if (fetched % 25 === 0) {
        console.log(`  Fetched ${fetched}/${jobsToFetch.length} job logs...`);
      }
    } catch (err) {
      if (err instanceof RateLimitExhaustedError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (isExpiredJobLogError(message)) {
        await ExpiredJobLog.upsertAll(
          [
            {
              job_id: jobId,
              job_name: jobName,
              pr_number: prNumber,
              checked_at: new Date().toISOString(),
            },
          ],
          { uniqueBy: "job_id" },
        );
        expired++;
        continue;
      }
      failed++;
      console.warn(
        `  Failed to fetch logs for job ${jobId} "${jobName}" (PR #${prNumber}): ${message}`,
      );
    }
  }

  console.log(`  Fetched ${fetched} job logs`);
  if (expired > 0) {
    console.log(`  ${expired} job log(s) past GitHub's retention window — will not be retried`);
  }
  if (fetched === 0 && (failed > 0 || expired === 0)) {
    throw new JobLogFetchFailedError(jobsToFetch.length, expired, failed);
  }
  return fetched;
}

const MISSING_STATS_PREDICATE = `
      NOT EXISTS (
        SELECT 1 FROM test_compare_stats tcs
        WHERE tcs.merge_commit_sha = rjl.merge_commit_sha
      )
      OR NOT EXISTS (
        SELECT 1 FROM api_compare_stats acs
        WHERE acs.merge_commit_sha = rjl.merge_commit_sha
      )
      OR (
        -- Only gate on privates stats when the job actually ran the
        -- --privates step. Historical logs from before the step was
        -- added would otherwise loop forever on --refresh.
        rjl.log_output LIKE '%compare.ts --privates%'
        AND NOT EXISTS (
          SELECT 1 FROM api_compare_privates_stats acps
          WHERE acps.merge_commit_sha = rjl.merge_commit_sha
        )
      )
      OR (
        -- Same shape as the privates gate: only expect calls stats from a job
        -- that actually ran the --calls step, so pre-RFC-0095 logs don't make
        -- --refresh reprocess the whole history on every run.
        (
          rjl.log_output LIKE '%compare.ts --calls%'
          OR rjl.log_output LIKE '%compare.ts --wide-calls%'
        )
        AND NOT EXISTS (
          SELECT 1 FROM api_calls_stats acls
          WHERE acls.merge_commit_sha = rjl.merge_commit_sha
        )
      )
      OR EXISTS (
        WITH expected(step_name, required) AS (
          VALUES
            ('api_compare', 1),
            ('test_compare', 1),
            ('api_compare_privates',
              CASE WHEN rjl.log_output LIKE '%compare.ts --privates%' THEN 1 ELSE 0 END)
        )
        SELECT 1 FROM expected e
        LEFT JOIN compare_logs cl
          ON cl.merge_commit_sha = rjl.merge_commit_sha AND cl.step_name = e.step_name
        WHERE e.required = 1 AND cl.step_name IS NULL
      )
`;

async function syncCompareStats(
  mode: "latest" | "refresh" | "backfill" | "reparse",
): Promise<number> {
  const limitClause = mode === "latest" ? "LIMIT 50" : "";
  const missingStatsClause = mode === "reparse" ? "" : `AND (${MISSING_STATS_PREDICATE})`;
  const runsToProcess = (
    await (
      await StatsSyncRecord.leaseConnection()
    ).selectAll(`
    SELECT rjl.job_id, rjl.merge_commit_sha, rjl.pr_number
    FROM raw_job_logs rjl
    JOIN workflow_jobs wj ON wj.id = rjl.job_id
    WHERE wj.name = 'Rails API/Test Comparison'
    AND wj.conclusion = 'success'
    AND rjl.job_id = (
      SELECT rjl2.job_id FROM raw_job_logs rjl2
      JOIN workflow_jobs wj2 ON wj2.id = rjl2.job_id
      WHERE rjl2.merge_commit_sha = rjl.merge_commit_sha
      AND wj2.name = 'Rails API/Test Comparison'
      AND wj2.conclusion = 'success'
      ORDER BY wj2.completed_at DESC
      LIMIT 1
    )
    ${missingStatsClause}
    ORDER BY rjl.pr_number DESC
    ${limitClause}
  `)
  ).toArray();

  if (runsToProcess.length === 0) {
    console.log("All compare stats already synced");
    return 0;
  }

  console.log(`Parsing compare stats from ${runsToProcess.length} job logs...`);
  let parsed = 0;
  let zeroParseTestCompare = 0;

  for (const row of runsToProcess) {
    const jobId = row.job_id as number;
    const headSha = row.merge_commit_sha as string;
    const prNumber = row.pr_number as number;

    const logRows = (
      await (
        await StatsSyncRecord.leaseConnection()
      ).execQuery(`SELECT log_output FROM raw_job_logs WHERE job_id = ?`, "SQL", [jobId])
    ).toArray();
    if (logRows.length === 0) continue;
    const logs = logRows[0].log_output as string;

    const stepLogs = extractStepLogs(logs);
    if (stepLogs.size > 0) {
      await CompareLog.upsertAll(
        [...stepLogs.entries()].map(([stepName, output]) => ({
          merge_commit_sha: headSha,
          pr_number: prNumber,
          step_name: stepName,
          log_output: output,
        })),
        { uniqueBy: ["merge_commit_sha", "step_name"] },
      );
    }

    const testStats = parseTestCompareFromLogs(logs);
    if (testStats.size === 0 && stepLogs.has("test_compare")) {
      zeroParseTestCompare++;
      console.warn(
        `  WARNING: PR #${prNumber} has a test_compare step log but 0 packages parsed — summary-line format drift?`,
      );
    }
    if (testStats.size > 0) {
      await TestCompareStat.upsertAll(
        [...testStats.entries()].map(([pkg, s]) => ({
          merge_commit_sha: headSha,
          pr_number: prNumber,
          package: pkg,
          matched: s.matched,
          total: s.total,
          percent: s.percent,
          skipped: s.skipped,
          files_mapped: s.filesMapped,
          files_total: s.filesTotal,
          misplaced: s.misplaced,
          assertion_count_mismatch: s.assertionCountMismatch,
          assertion_kind_mismatch: s.assertionKindMismatch,
        })),
        { uniqueBy: ["merge_commit_sha", "package"] },
      );
    }

    // Parse the public-API step in isolation so the privates step (same log
    // format, appended below it) doesn't overwrite entries.
    const apiStepLog = stepLogs.get("api_compare") ?? "";
    const apiStats = apiStepLog
      ? parseApiCompareFromLogs(apiStepLog)
      : parseApiCompareFromLogs(logs);
    if (apiStats.size > 0) {
      await ApiCompareStat.upsertAll(
        [...apiStats.entries()].map(([pkg, s]) => ({
          merge_commit_sha: headSha,
          pr_number: prNumber,
          package: pkg,
          matched: s.matched,
          total: s.total,
          percent: s.percent,
          misplaced: s.misplaced,
          missing: s.missing,
        })),
        { uniqueBy: ["merge_commit_sha", "package"] },
      );
    }

    const apiPrivatesStepLog = stepLogs.get("api_compare_privates") ?? "";
    const apiPrivatesStats = apiPrivatesStepLog
      ? parseApiCompareFromLogs(apiPrivatesStepLog)
      : parseApiCompareFromLogs("");
    if (apiPrivatesStats.size > 0) {
      await ApiComparePrivatesStat.upsertAll(
        [...apiPrivatesStats.entries()].map(([pkg, s]) => ({
          merge_commit_sha: headSha,
          pr_number: prNumber,
          package: pkg,
          matched: s.matched,
          total: s.total,
          percent: s.percent,
          missing: s.missing,
        })),
        { uniqueBy: ["merge_commit_sha", "package"] },
      );
    }

    // Advisory call summaries. Whole-repo totals printed once by the --calls
    // run, so one row each, under package "all".
    const callsStepLog = stepLogs.get("api_calls") ?? "";
    const { calls, callArgs } = parseCallSummariesFromLogs(callsStepLog);
    if (calls) {
      await ApiCallsStat.upsertAll(
        [
          {
            merge_commit_sha: headSha,
            pr_number: prNumber,
            package: "all",
            matched: calls.matched,
            total: calls.total,
            percent: calls.percent,
            mismatched: calls.mismatched,
          },
        ],
        { uniqueBy: ["merge_commit_sha", "package"] },
      );
    }
    if (callArgs) {
      await ApiCallArgsStat.upsertAll(
        [
          {
            merge_commit_sha: headSha,
            pr_number: prNumber,
            package: "all",
            matched: callArgs.matched,
            total: callArgs.total,
            percent: callArgs.percent,
            mismatched: callArgs.mismatched,
          },
        ],
        { uniqueBy: ["merge_commit_sha", "package"] },
      );
    }

    if (stepLogs.size > 0 || testStats.size > 0 || apiStats.size > 0 || apiPrivatesStats.size > 0) {
      parsed++;
      const totalTests = [...testStats.values()].reduce((sum, s) => sum + s.matched, 0);
      const totalApi = [...apiStats.values()].reduce((sum, s) => sum + s.matched, 0);
      const totalApiPrivates = [...apiPrivatesStats.values()].reduce(
        (sum, s) => sum + s.matched,
        0,
      );
      const logSteps = [...stepLogs.keys()].join(", ");
      const callsNote = calls ? `, calls ${calls.matched}/${calls.total}` : "";
      const argsNote = callArgs ? `, call args ${callArgs.matched}/${callArgs.total}` : "";
      console.log(
        `  PR #${prNumber}: ${testStats.size} test packages (${totalTests} matched), ${apiStats.size} api packages (${totalApi} matched), ${apiPrivatesStats.size} api-privates packages (${totalApiPrivates} matched)${callsNote}${argsNote}, logs: [${logSteps}]`,
      );
    }
  }

  if (zeroParseTestCompare > 0) {
    console.warn(
      `\n  WARNING: ${zeroParseTestCompare} job log(s) had a test_compare step but produced no package rows. ` +
        `The test_compare_stats feed is going stale — check parseTestCompareFromLogs against the current summary format.`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

async function printSummary() {
  const count = async (table: string) => {
    const rows = (
      await (await StatsSyncRecord.leaseConnection()).selectAll(`SELECT COUNT(*) as cnt FROM ${table}`)
    ).toArray();
    return (rows[0] as { cnt: number }).cnt;
  };
  const countDistinct = async (table: string, col: string) => {
    const rows = (
      await (
        await StatsSyncRecord.leaseConnection()
      ).selectAll(`SELECT COUNT(DISTINCT ${col}) as cnt FROM ${table}`)
    ).toArray();
    return (rows[0] as { cnt: number }).cnt;
  };

  const [
    prCount,
    runCount,
    jobCount,
    stepCount,
    testStatCount,
    apiStatCount,
    apiPrivatesStatCount,
    logCount,
    rawLogCount,
  ] = await Promise.all([
    count("pull_requests"),
    count("workflow_runs"),
    count("workflow_jobs"),
    count("workflow_steps"),
    countDistinct("test_compare_stats", "merge_commit_sha"),
    countDistinct("api_compare_stats", "merge_commit_sha"),
    countDistinct("api_compare_privates_stats", "merge_commit_sha"),
    countDistinct("compare_logs", "merge_commit_sha"),
    count("raw_job_logs"),
  ]);

  const stateRows = (
    await (
      await StatsSyncRecord.leaseConnection()
    ).selectAll(`SELECT state, COUNT(*) as cnt FROM pull_requests GROUP BY state ORDER BY state`)
  ).toArray() as { cnt: number; state: string }[];
  const stateParts = stateRows.map((r) => `${r.cnt} ${r.state}`).join(", ");

  banner("Database Summary");
  console.log(`  PRs: ${prCount} (${stateParts})`);

  const [
    fileCount,
    commitCount,
    commentCount,
    reviewCount,
    requestedReviewerCount,
    linkedIssueCount,
    timelineEventCount,
    reactionCount,
    annotationCount,
  ] = await Promise.all([
    count("pr_files"),
    count("pr_commits"),
    count("pr_comments"),
    count("pr_reviews"),
    count("pr_requested_reviewers"),
    count("pr_linked_issues"),
    count("pr_timeline_events"),
    count("pr_reactions"),
    count("check_annotations"),
  ]);
  console.log(`  PR files: ${fileCount}`);
  console.log(`  PR commits: ${commitCount}`);
  console.log(`  PR comments: ${commentCount}`);
  console.log(`  PR reviews: ${reviewCount}`);
  console.log(`  PR requested reviewers: ${requestedReviewerCount}`);
  console.log(`  PR linked issues: ${linkedIssueCount}`);
  console.log(`  PR timeline events: ${timelineEventCount}`);
  console.log(`  PR reactions: ${reactionCount}`);
  console.log(`  Check annotations: ${annotationCount}`);

  console.log(`  Workflow runs: ${runCount}`);
  console.log(`  Workflow jobs: ${jobCount} (${rawLogCount} logs fetched)`);
  console.log(`  Workflow steps: ${stepCount}`);
  console.log(`  Commits with parity:test stats: ${testStatCount}`);
  console.log(`  Commits with parity:api stats: ${apiStatCount}`);
  console.log(`  Commits with parity:api --privates stats: ${apiPrivatesStatCount}`);
  console.log(`  Commits with compare logs: ${logCount}`);

  const latestTestStats = await TestCompareStat.findBySql(`
    SELECT package, matched, total, percent, skipped
    FROM test_compare_stats
    WHERE merge_commit_sha = (
      SELECT merge_commit_sha FROM test_compare_stats ORDER BY pr_number DESC LIMIT 1
    )
    ORDER BY package
  `);

  if (latestTestStats.length > 0) {
    console.log("\n  Latest parity:test:");
    for (const row of latestTestStats) {
      const pkg = row.readAttribute("package");
      const matched = row.readAttribute("matched");
      const total = row.readAttribute("total");
      const percent = row.readAttribute("percent");
      const skipped = row.readAttribute("skipped") as number;
      const skipStr = skipped > 0 ? ` (${skipped} skipped)` : "";
      console.log(`    ${pkg}: ${matched}/${total} (${percent}%)${skipStr}`);
    }
  }

  const latestApiStats = await ApiCompareStat.findBySql(`
    SELECT package, matched, total, percent, missing
    FROM api_compare_stats
    WHERE merge_commit_sha = (
      SELECT merge_commit_sha FROM api_compare_stats ORDER BY pr_number DESC LIMIT 1
    )
    ORDER BY package
  `);

  if (latestApiStats.length > 0) {
    console.log("\n  Latest parity:api:");
    for (const row of latestApiStats) {
      const pkg = row.readAttribute("package");
      const matched = row.readAttribute("matched");
      const total = row.readAttribute("total");
      const percent = row.readAttribute("percent");
      const missing = row.readAttribute("missing") as number;
      const missStr = missing > 0 ? ` (${missing} missing)` : "";
      console.log(`    ${pkg}: ${matched}/${total} (${percent}%)${missStr}`);
    }
  }

  const latestApiPrivatesStats = await ApiComparePrivatesStat.findBySql(`
    SELECT package, matched, total, percent, missing
    FROM api_compare_privates_stats
    WHERE merge_commit_sha = (
      SELECT merge_commit_sha FROM api_compare_privates_stats ORDER BY pr_number DESC LIMIT 1
    )
    ORDER BY package
  `);

  if (latestApiPrivatesStats.length > 0) {
    console.log("\n  Latest parity:api --privates:");
    for (const row of latestApiPrivatesStats) {
      const pkg = row.readAttribute("package");
      const matched = row.readAttribute("matched");
      const total = row.readAttribute("total");
      const percent = row.readAttribute("percent");
      const missing = row.readAttribute("missing") as number;
      const missStr = missing > 0 ? ` (${missing} missing)` : "";
      console.log(`    ${pkg}: ${matched}/${total} (${percent}%)${missStr}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * One `stats:sync --latest` run. Imported only when a job runs: importing this
 * module opens STATS_SYNC_DB on its own connection, apart from the read-only
 * `Stats` pool, because this one writes.
 */
export async function syncLatest(): Promise<void> {
  stage = "startup";
  try {
    const adapter = (await StatsSyncRecord.leaseConnection()) as SQLite3Adapter;
    await migrateDb(adapter);

    banner("Syncing PR data");
    const prsSynced = await syncPullRequests("latest");
    banner("Syncing PR files");
    await syncPrFiles();
    banner("Syncing PR commits");
    await syncPrCommits();
    banner("Syncing PR comments & reviews");
    await syncPrComments();
    banner("Syncing PR requested reviewers");
    await syncPrRequestedReviewers();
    banner("Syncing PR linked issues");
    await syncPrLinkedIssues();
    banner("Syncing PR timeline events");
    await syncPrTimelineEvents();
    await syncPrReactions();
    banner("Syncing workflow runs");
    const runsSynced = await syncWorkflowRuns("latest");
    banner("Syncing job logs");
    await syncJobLogs("latest");
    banner("Syncing compare stats from CI logs");
    const logsParsed = await syncCompareStats("latest");
    banner("Syncing check annotations");
    await syncCheckAnnotations("latest");

    await SyncLog.create({
      synced_at: new Date().toISOString(),
      prs_synced: prsSynced,
      runs_synced: runsSynced,
      logs_parsed: logsParsed,
    });
    await printSummary();
  } catch (err) {
    if (!(err instanceof RateLimitExhaustedError)) throw err;
    console.warn(`\n${err.message}`);
    console.warn("Run again later to continue syncing remaining data.");
    await printSummary();
  }
}
