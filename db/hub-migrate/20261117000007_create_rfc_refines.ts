import { Migration } from "@blazetrails/activerecord";

/**
 * The refine reports an RFC-refine agent sends when it finishes
 * (`scripts/rfc-refine-done.sh`, kind=rfc-refine): which RFC, its outcome,
 * and the summary it wrote, in markdown. ringo kept only the latest per RFC
 * in a local `refines.json`; every report is a row here, and the RFC page's
 * Refinements tab reads the newest first. In the hub because trailmap owns
 * it: the tasks database is the CLI's, and trailmap never migrates it.
 */
export class CreateRfcRefines extends Migration.get(8) {
  async change() {
    await this.createTable("rfc_refines", (t) => {
      t.string("rfc_id", { null: false });
      t.string("outcome", { null: false });
      t.text("summary", { null: false, default: "" });
      t.timestamps();

      t.index(["rfc_id", "created_at"], { name: "index_rfc_refines_on_rfc_id_and_created_at" });
    });
  }
}
