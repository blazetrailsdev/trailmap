import { Migration } from "@blazetrails/activerecord";

/**
 * The application-wide settings — ringo's origin, which until now existed only
 * as `RINGO_BASE`.
 *
 * Key/value, like `meta` in the task database, because these are a handful of
 * operator-set strings rather than a schema. A row overrides the environment
 * variable of the same meaning; see `app/models/setting.ts` for why that
 * direction and not the other.
 */
export class CreateSettings extends Migration {
  async change() {
    // `id: "string", primaryKey: "key"` creates the key column itself, as
    // db/migrate/20260825000005_create_meta.ts does for the same shape.
    await this.createTable("settings", { id: "string", primaryKey: "key" }, (t) => {
      t.text("value");
      t.timestamps();
    });
  }
}
