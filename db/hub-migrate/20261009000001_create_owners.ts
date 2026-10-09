import { Migration } from "@blazetrails/activerecord";

/**
 * The first migration of the `hub` database — PostgreSQL, not the SQLite the
 * task domain lives in, and migrated on its own with
 * `trails db migrate --database hub` (see config/database.ts).
 */
export class CreateOwners extends Migration {
  async change() {
    // A surrogate primary key, unlike `rfcs` and `stories` whose slugs are
    // their natural keys: a login is renameable, and renaming a primary key
    // rewrites every foreign key pointing at it.
    await this.createTable("owners", (t) => {
      t.string("login", { null: false });
      t.string("kind", { null: false, default: "organization" });
      t.string("display_name");
      t.text("description");
      t.string("avatar_url");
      t.timestamps();
      // Case-insensitive, because `Owner.findByLogin` and the uniqueness
      // validation both are — GitHub resolves `/BlazeTrailsDev` to the same
      // account, and an index that disagreed would let two rows differ only
      // in case and make which one a URL finds depend on row order.
      t.index("lower(login)", { unique: true, name: "index_owners_on_lower_login" });
      t.index(["kind"]);
    });
  }
}
