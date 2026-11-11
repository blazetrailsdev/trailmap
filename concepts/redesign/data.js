// Fake data for the redesign concepts. Nothing here is real.
window.STAGES = [
  { key: "drafting", label: "Drafting", short: "Draft" },
  { key: "self", label: "Self review", short: "Self" },
  { key: "ringo", label: "Reviewer convergence", short: "Ringo" },
  { key: "ci", label: "Getting CI green", short: "CI" },
  { key: "ready", label: "Ready to merge", short: "Ready" },
  { key: "merged", label: "Merged", short: "Merged" },
];

window.SESSIONS = [
  { repo: "trails", id: "f1", fixer: true, stage: "drafting", story: "ar-mariadb-shard-flake", pr: null, branch: "ar-mariadb-shard-flake-3c1e", loc: 38, age: "12m", note: "AR MariaDB Tests (2/3) is red on main · spawning is paused until it is green" },
  { repo: "trails", id: "s1", stage: "drafting", story: "port-relation-or-structurally-compatible", rfc: "0047", pr: null, branch: "relation-or-compat-4a1c", loc: 212, age: "14m", note: "Reading relation/query_methods.rb" },
  { repo: "trails", id: "s2", stories: ["arel-visitor-nodes-cte-materialized", "arel-visitor-nodes-cte-not-materialized", "arel-with-recursive-visitor-arm"], stage: "self", story: "arel-visitor-nodes-cte-materialized", rfc: "0112", pr: 9961, branch: "arel-cte-materialized-77e0", loc: 348, age: "41m", idle: "35m", note: "parity:api:calls finished, 0 new mismatches" },
  { repo: "trails", id: "s3", stories: ["actionmailer-preview-interceptors", "actionmailer-preview-register-interceptor-string-arm"], stage: "ringo", story: "actionmailer-preview-interceptors", rfc: "0188", pr: 9958, branch: "mailer-preview-intc-2b9d", loc: 506, age: "2h", note: "Converging finding 4: keep the String arm", ask: { q: "Finding 5 asks for a scoped skip. OK to add, or converge?", options: ["Add the scoped skip", "Converge without it"] }, ringo: { done: 3, total: 5 } },
  { repo: "trails", id: "s4", stories: ["zeitwerk-eager-load-namespace"], stage: "ci", story: "zeitwerk-eager-load-namespace", rfc: "0151", pr: 9952, branch: "zeitwerk-eager-ns-c013", loc: 274, age: "3h", note: "AR MariaDB Tests (2/3) red, retrying", ci: { pass: 41, fail: 1, run: 3 } },
  { repo: "trails", id: "s5", stories: ["rake-file-utils-ext-nowrite", "rake-file-utils-ext-verbose", "rake-file-utils-ext-when-writing", "rake-file-utils-ext-rake-check-options"], stage: "ready", story: "rake-file-utils-ext-nowrite", rfc: "0203", pr: 9949, branch: "rake-nowrite-9d2a", loc: 189, age: "5h", note: "Approved by the reviewer" },
  { repo: "trails", id: "s6", stories: ["image-processing-vips-thumbnail", "image-processing-vips-crop-gravity"], stage: "merged", story: "image-processing-vips-thumbnail", rfc: "0199", pr: 9944, branch: "vips-thumbnail-e1f7", loc: 421, age: "8h", note: "Post-merge findings filed" },
  { repo: "trails", id: "s7", stage: "ringo", story: "activemodel-dirty-changes-applied", rfc: "0197", pr: 9960, branch: "am-dirty-applied-5c3b", loc: 302, age: "1h", note: "Reviewer rv-34 on its first pass", ringo: { done: 0, total: 4 } },
  { repo: "trails", id: "s8", stage: "ci", story: "actionpack-params-wrapper-inherited", rfc: "0164", pr: 9957, branch: "params-wrapper-inh-0aa8", loc: 158, age: "2h", note: "Lint + Unit Tests running", ci: { pass: 28, fail: 0, run: 14 } },
  { repo: "trailmap", id: "m1", stage: "drafting", story: "fleet-session-stepper-list", stories: ["fleet-session-stepper-list", "fleet-bundle-story-links"], pr: null, branch: "fleet-stepper-7c2e", loc: 96, age: "9m", note: "Sketching the fleet list partial" },
  { repo: "trailmap", id: "m2", stage: "ci", story: "panes-send-line-e2e", pr: 137, branch: "panes-send-e2e-1b4f", loc: 233, age: "1h", idle: "22m", note: "All 12 checks green", ci: { pass: 12, fail: 0, run: 0 } },
  { repo: "trailmap", id: "m3", stage: "merged", story: "deploys-log-relay", pr: 134, branch: "deploys-log-relay-a90d", loc: 188, age: "6h", note: "Deployed to dokku" },
  { repo: "tasks", id: "t1", stage: "self", story: "cli-next-bundle-prefers-shared-rfc", pr: 412, branch: "next-bundle-rfc-3e8a", loc: 141, age: "25m", note: "Running tasks validate" },
  { repo: "tasks", id: "t2", stage: "ringo", story: "ingest-owned-fields-guard-closed-reason", stories: ["ingest-owned-fields-guard-closed-reason", "ingest-owned-fields-guard-assignee"], pr: 409, branch: "owned-fields-guard-55d1", loc: 207, age: "1h", note: "Converging the assignee guard", ask: { q: "Should closed-reason be DB-owned too, or stay in markdown?", options: ["DB-owned", "Stay in markdown"] }, ringo: { done: 1, total: 2 } },
  { repo: "tasks", id: "t3", stage: "ready", story: "export-stable-frontmatter-order", pr: 407, branch: "export-fm-order-c4b0", loc: 64, age: "3h", note: "Approved by the reviewer" },
];

window.LOG_S3 = [
  { t: "09:12:04", k: "sys", text: "Session started in worktree <span class='mono'>mailer-preview-intc-2b9d</span>" },
  { t: "09:12:09", k: "tool", tool: "tasks claim actionmailer-preview-interceptors" },
  { t: "09:12:31", k: "tool", tool: "Read vendor/rails/v8.0.2/actionmailer/lib/action_mailer/preview.rb" },
  { t: "09:14:02", k: "say", text: "Rails registers interceptors on <span class='mono'>Preview.preview_interceptors</span>; porting <span class='mono'>register_preview_interceptor</span> first." },
  { t: "09:31:47", k: "tool", tool: "Edit packages/actionmailer/src/preview.ts (+84 −12)" },
  { t: "09:38:15", k: "tool", tool: "pnpm vitest run packages/actionmailer/src/preview.test.ts", ok: "14 passed" },
  { t: "09:39:00", k: "transition", stage: "self", text: "Moved to <b>Self review</b>" },
  { t: "09:41:22", k: "tool", tool: "pnpm parity:api:calls", ok: "0 new mismatches" },
  { t: "09:43:10", k: "warn", text: "parity:api:extra flagged <span class='mono'>previewInterceptorsFor</span>: no Ruby counterpart, folded into ported method" },
  { t: "09:52:40", k: "tool", tool: "gh pr create --draft  →  #9958" },
  { t: "09:53:02", k: "transition", stage: "ringo", text: "Moved to <b>Reviewer convergence</b> · Ringo spawned reviewer <span class='mono'>rv-31</span>" },
  { t: "10:20:18", k: "sys", text: "Review received: 5 findings (2 fidelity, 2 correctness, 1 test-coverage)" },
  { t: "10:24:51", k: "tool", tool: "Edit packages/actionmailer/src/preview.ts (+9 −6)" },
  { t: "10:31:05", k: "say", text: "Converged findings 1–3: Rails raise site restored, kwarg default matched, test name restored." },
  { t: "10:44:12", k: "user", text: "Finding 4 — keep the String arm, Rails accepts both." },
  { t: "10:44:40", k: "say", text: "Ack, porting the String arm of <span class='mono'>interceptor_class_for</span> now." },
];

// Every other session gets a log built from its own story, PR and stage.
const _t = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
window.logFor = (s) => {
  if (s.id === "s3") return LOG_S3;
  const at = STAGES.findIndex((x) => x.key === s.stage);
  const stories = s.stories || [s.story];
  const rows = [{ t: _t(8, 30), k: "sys", text: `Session started in worktree <span class='mono'>${s.branch}</span>` }];
  stories.forEach((id, i) => rows.push({ t: _t(8, 31 + i), k: "tool", tool: `tasks claim ${id}` }));
  rows.push({ t: _t(8, 40), k: "say", text: s.note });
  if (at >= 1) rows.push({ t: _t(9, 2), k: "tool", tool: `gh pr create --draft  →  ${s.repo}#${s.pr}` }, { t: _t(9, 5), k: "transition", stage: "self", text: "Moved to <b>Self review</b>" }, { t: _t(9, 12), k: "tool", tool: "pnpm parity:api:calls", ok: "0 new mismatches" });
  if (at >= 2) rows.push({ t: _t(9, 31), k: "transition", stage: "ringo", text: "Moved to <b>Reviewer convergence</b> · Ringo spawned a reviewer" });
  if (s.ringo) rows.push({ t: _t(10, 2), k: "sys", text: `Review received: ${s.ringo.total} findings, ${s.ringo.done} converged so far` });
  if (at >= 3) rows.push({ t: _t(10, 40), k: "transition", stage: "ci", text: "Moved to <b>Getting CI green</b> · review converged" });
  if (s.ci && s.ci.fail) rows.push({ t: _t(11, 5), k: "warn", text: `${s.ci.fail} check failed, rerunning` });
  if (at >= 4) rows.push({ t: _t(11, 30), k: "transition", stage: "ready", text: "Moved to <b>Ready to merge</b> · all checks green" });
  if (at >= 5) rows.push({ t: _t(12, 10), k: "transition", stage: "merged", text: `Merged ${s.repo}#${s.pr}` });
  return rows;
};
