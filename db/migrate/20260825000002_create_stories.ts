import { Migration } from "@blazetrails/activerecord";

export class CreateStories extends Migration {
  async change() {
    // Story slug is the natural key: what agents type, what PR bodies cite, and
    // what the spawn loop passes around.
    await this.createTable("stories", { id: "string" }, (t) => {
      t.string("rfc_id", { null: false });
      t.string("title");
      t.string("cluster");
      t.integer("priority");
      t.integer("est_loc");
      t.string("file_path");

      // ── DB-owned state. Never written by ingest. ──
      t.string("status", { null: false, default: "draft" });
      t.integer("pr");
      t.string("assignee");
      t.string("blocked_by");
      t.text("closed_reason");
      // TEXT, not datetime, deliberately. The exact string is the contract:
      // btwhooks parses `claim` out of index.json for stale-claim detection and
      // the repo's 5,131 existing values are ISO-seconds-Z. A datetime column
      // makes the adapter normalize writes to "YYYY-MM-DD HH:MM:SS", which
      // silently changed the format of the first story claimed through the new
      // CLI. Keep the text opaque so nothing can reformat it.
      t.string("claim_at");

      t.timestamps();

      // The claim predicate is `WHERE id = ? AND status = ?`; the ready-queue
      // scan filters on status, then groups by rfc_id.
      t.index(["status"]);
      t.index(["rfc_id", "status"]);
    });
  }
}
