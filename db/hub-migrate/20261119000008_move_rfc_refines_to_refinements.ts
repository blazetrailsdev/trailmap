import { Migration } from "@blazetrails/activerecord";
import { StringIO } from "@blazetrails/ruby-compat";
import { Refinement } from "../../app/models/refinement.ts";

/**
 * RFC 0243, Decision 1: the refine reports move off the hub. Every
 * `rfc_refines` row becomes a `Refinement` on `Base`, its summary attached
 * and its timestamps kept, and the hub table is dropped. The `refinements`
 * table is the tasks CLI's migration's. `down` recreates the hub table as
 * 20261117000007 made it and moves the rows back.
 */
export class MoveRfcRefinesToRefinements extends Migration.get(8) {
  async up() {
    const connection = await this.connection;
    const rows = await connection.selectAll(
      "SELECT rfc_id, outcome, summary, created_at, updated_at FROM rfc_refines ORDER BY id",
    );
    for (const row of rows) {
      const refinement = await Refinement.create({
        rfc_id: row.rfc_id,
        outcome: row.outcome,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      await refinement.summary.attach({
        io: new StringIO(String(row.summary)),
        filename: "summary.md",
        contentType: "text/markdown",
      });
      // The attachment touches its record.
      await refinement.updateColumn("updated_at", row.updated_at);
    }
    await this.dropTable("rfc_refines");
  }

  async down() {
    await this.createTable("rfc_refines", (t) => {
      t.string("rfc_id", { null: false });
      t.string("outcome", { null: false });
      t.text("summary", { null: false, default: "" });
      t.timestamps();

      t.index(["rfc_id", "created_at"], { name: "index_rfc_refines_on_rfc_id_and_created_at" });
    });
    const connection = await this.connection;
    for (const refinement of await Refinement.order({ id: "asc" }).toArray()) {
      const blob = await (await refinement.summary.attachment)?.blob;
      const summary = blob == null ? "" : new TextDecoder().decode(await blob.download());
      const values = [refinement.rfc_id, refinement.outcome, summary, refinement.created_at, refinement.updated_at];
      await connection.execute(
        "INSERT INTO rfc_refines (rfc_id, outcome, summary, created_at, updated_at) " +
          `VALUES (${values.map((value) => connection.quote(value)).join(", ")})`,
      );
      await refinement.summary.purge();
      await refinement.destroy();
    }
  }
}
