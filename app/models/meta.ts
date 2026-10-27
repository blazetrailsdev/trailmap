import { ApplicationRecord } from "./application-record.ts";

/** Key/value watermarks. `last_ingested_sha` makes `tasks ingest` incremental. */
export class Meta extends ApplicationRecord {
  declare key: string;
  declare value: string | null;

  static async get(key: string): Promise<string | null> {
    return (await Meta.findBy({ key }))?.value ?? null;
  }

  static async set(key: string, value: string): Promise<void> {
    await (await Meta.findOrInitializeBy({ key })).update({ value });
  }
}
