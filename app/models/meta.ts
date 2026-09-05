import { Base } from "@blazetrails/activerecord";

/** Key/value watermarks. `last_ingested_sha` makes `tasks ingest` incremental. */
export class Meta extends Base {
  static _tableName = "meta";
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
