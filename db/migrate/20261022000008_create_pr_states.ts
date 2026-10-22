import { Migration } from "@blazetrails/activerecord";

export class CreatePrStates extends Migration.get(8) {
  async change() {
    // ringo's PR tracker (`PRState`, webhook/tracker.go), one row per PR in
    // place of `tracker-state.json`'s whole-map rewrite. ringo writes it and
    // trailmap only reads it (config/write-protocol.ts); the migration is here
    // because every table in this file is migrated here.
    //
    // A column per field, never a JSON blob — a blob would be the file again,
    // unqueryable, inside a table. `labels` is the one list, and it is a
    // newline-joined string rather than a join table because it is only ever
    // displayed whole.
    await this.createTable("pr_states", { primaryKey: ["owner", "repo", "pr"] }, (t) => {
      t.string("owner", { null: false });
      t.string("repo", { null: false });
      t.integer("pr", { null: false });
      t.string("branch", { null: false, default: "" });
      t.string("title", { null: false, default: "" });
      t.text("labels", { null: false, default: "" });
      t.boolean("draft", { null: false, default: false });
      t.boolean("merge_conflict", { null: false, default: false });
      t.boolean("behind", { null: false, default: false });
      t.integer("comment_count", { null: false, default: 0 });
      t.integer("review_cycles", { null: false, default: 0 });
      t.integer("open_findings", { null: false, default: 0 });
      t.boolean("open_findings_known", { null: false, default: false });
      t.string("pane_status", { null: false, default: "" });
      t.string("ci_status", { null: false, default: "" });
      t.string("last_action", { null: false, default: "" });
      // TEXT timestamps, RFC 3339 as Go writes them, like stories.claim_at:
      // "" is Go's zero time, which ringo reads as "never".
      t.string("last_time", { null: false, default: "" });
      t.string("next_action", { null: false, default: "" });
      t.string("pane", { null: false, default: "" });
      t.boolean("pane_manual", { null: false, default: false });
      // The debounces. Their reset rules are ringo's, and its tests pin them:
      // `notified` and `ci_success_notified` are once per PR lifetime (the
      // latter is NOT reset on push); `ci_failure_notified` and
      // `cycles_exhausted_notified` reset on every push.
      t.boolean("notified", { null: false, default: false });
      t.boolean("ci_failure_notified", { null: false, default: false });
      t.boolean("ci_success_notified", { null: false, default: false });
      t.boolean("cycles_exhausted_notified", { null: false, default: false });
      t.string("closed_seen_at", { null: false, default: "" });
      t.boolean("merged", { null: false, default: false });
      t.boolean("merged_checked", { null: false, default: false });
      t.index(["pane"]);
    });
  }
}
