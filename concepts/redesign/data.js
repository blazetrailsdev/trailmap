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
  { id: "s1", stage: "drafting", story: "port-relation-or-structurally-compatible", rfc: "0047", pr: null, branch: "relation-or-compat-4a1c", pkg: "activerecord", loc: 212, age: "14m", note: "Reading relation/query_methods.rb" },
  { id: "s2", stories: ["arel-visitor-nodes-cte-materialized", "arel-visitor-nodes-cte-not-materialized", "arel-with-recursive-visitor-arm"], stage: "self", story: "arel-visitor-nodes-cte-materialized", rfc: "0112", pr: 9961, branch: "arel-cte-materialized-77e0", pkg: "arel", loc: 348, age: "41m", note: "Running parity:api:calls before review" },
  { id: "s3", stories: ["actionmailer-preview-interceptors", "actionmailer-preview-register-interceptor-string-arm"], stage: "ringo", story: "actionmailer-preview-interceptors", rfc: "0188", pr: 9958, branch: "mailer-preview-intc-2b9d", pkg: "actionmailer", loc: 506, age: "2h", note: "Ringo reviewer: 3 of 5 findings converged", ringo: { done: 3, total: 5 } },
  { id: "s4", stories: ["zeitwerk-eager-load-namespace"], stage: "ci", story: "zeitwerk-eager-load-namespace", rfc: "0151", pr: 9952, branch: "zeitwerk-eager-ns-c013", pkg: "zeitwerk", loc: 274, age: "3h", note: "AR MariaDB Tests (2/3) red, retrying", ci: { pass: 41, fail: 1, run: 3 } },
  { id: "s5", stories: ["rake-file-utils-ext-nowrite", "rake-file-utils-ext-verbose", "rake-file-utils-ext-when-writing", "rake-file-utils-ext-rake-check-options"], stage: "ready", story: "rake-file-utils-ext-nowrite", rfc: "0203", pr: 9949, branch: "rake-nowrite-9d2a", pkg: "rake", loc: 189, age: "5h", note: "All checks green · approved" },
  { id: "s6", stories: ["image-processing-vips-thumbnail", "image-processing-vips-crop-gravity"], stage: "merged", story: "image-processing-vips-thumbnail", rfc: "0199", pr: 9944, branch: "vips-thumbnail-e1f7", pkg: "image-processing", loc: 421, age: "8h", note: "Merged to main · post-merge findings filed" },
  { id: "s7", stage: "ringo", story: "activemodel-dirty-changes-applied", rfc: "0197", pr: 9960, branch: "am-dirty-applied-5c3b", pkg: "activemodel", loc: 302, age: "1h", note: "Ringo reviewer spawned, first pass", ringo: { done: 0, total: 4 } },
  { id: "s8", stage: "ci", story: "actionpack-params-wrapper-inherited", rfc: "0164", pr: 9957, branch: "params-wrapper-inh-0aa8", pkg: "actionpack", loc: 158, age: "2h", note: "Lint + Unit Tests running", ci: { pass: 28, fail: 0, run: 14 } },
];

window.LOG = [
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
