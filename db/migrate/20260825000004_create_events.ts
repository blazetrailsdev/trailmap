import { Migration } from "@blazetrails/activerecord";

export class CreateEvents extends Migration {
  async change() {
    // Append-only. Replaces parsing 27k git commit subjects: this is what the
    // velocity and RFC burndown charts read.
    await this.createTable("events", (t) => {
      // TEXT for the same reason as stories.claim_at: the timestamp text is
      // the contract with the chart collectors, not a value to be re-rendered.
      t.string("at", { null: false });
      t.string("verb", { null: false });
      t.string("story_id");
      t.string("rfc_id");
      t.integer("pr");
      t.string("actor");
      t.text("detail");
      t.index(["at"]);
      t.index(["verb"]);
      t.index(["story_id"]);
      t.index(["rfc_id"]);
    });
  }
}
