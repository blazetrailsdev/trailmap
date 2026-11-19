import { Migration } from "@blazetrails/activerecord";

/**
 * RFC 0243, Decision 1: the refine reports move off the hub, onto `Base` as
 * `Refinement` records (the tasks CLI's 20261118000013 makes their table).
 * This migration drops the hub's `rfc_refines`.
 *
 * It does NOT copy rows to `Base`, and cannot. `trails db:migrate`, like
 * Rails' `DatabaseTasks.migrate`, runs each database's migrations inside
 * `withTemporaryPool`, which re-establishes `Base` itself on that database. In
 * a hub migration every `Base` model, Active Storage's included, is on the hub
 * Postgres, where `refinements` does not exist. The first version of this
 * migration tried, and failed every deploy's release task with "the tasks
 * database has no refinements table" while the table was sitting in tasks.db.
 *
 * When it shipped, no hub had a single `rfc_refines` row (production, the dev
 * hubs and the PR apps were all checked), because ingest never wrote one. So
 * there is nothing to move, and a hub that does have rows refuses to migrate
 * rather than lose them.
 */
export class MoveRfcRefinesToRefinements extends Migration.get(8) {
  async up() {
    const connection = await this.connection;
    const [{ count }] = (
      await connection.selectAll("SELECT COUNT(*) AS count FROM rfc_refines")
    ).toArray();
    if (Number(count) > 0) {
      throw new Error(
        `rfc_refines holds ${count} row(s); this migration drops it and cannot move them to Base ` +
          "(Base is the hub's connection while hub migrations run). Move them first.",
      );
    }
    await this.dropTable("rfc_refines");
  }

  /** The hub table as 20261117000007 made it, empty. */
  async down() {
    await this.createTable("rfc_refines", (t) => {
      t.string("rfc_id", { null: false });
      t.string("outcome", { null: false });
      t.text("summary", { null: false, default: "" });
      t.timestamps();

      t.index(["rfc_id", "created_at"], {
        name: "index_rfc_refines_on_rfc_id_and_created_at",
      });
    });
  }
}
