import { Base } from "@blazetrails/activerecord";

/** Key/value watermarks. `last_ingested_sha` makes `tasks ingest` incremental. */
export class Meta extends Base {
  static _tableName = "meta";
  // The class-field form is correct HERE and wrong for a composite key (see
  // the note in app/models/repository-collaborator.ts). What the `primaryKey`
  // SETTER adds over the field is `_compositePrimaryKey` — whose right value
  // for a string is the `false` the field leaves in place — and resetting the
  // attributes builder and predicate builder, which are unbuilt at class
  // definition time anyway. A single column is genuinely exempt; an array is
  // not.
  static _primaryKey = "key";

  declare key: string;
  declare value: string | null;

  static async get(key: string): Promise<string | null> {
    const row = await Meta.findBy({ key });
    return row?.value ?? null;
  }

  static async set(key: string, value: string): Promise<void> {
    const row = await Meta.findBy({ key });
    if (row) {
      row.value = value;
      await row.save();
    } else {
      await Meta.create({ key, value });
    }
  }
}
