// Copied by hand from @blazetrails/activestorage lib/db/migrate/20170806125915: no
// `active_storage:install` yet (story active-storage-install-copies-migrations).
// On the hub, beside the audits whose reports it stores.
import { Migration } from "@blazetrails/activerecord";
import { TopLevel } from "@blazetrails/activesupport";

export class CreateActiveStorageTables extends Migration.get(7.0) {
  async change(): Promise<void> {
    const [primaryKeyType, foreignKeyType] = this.primaryAndForeignKeyTypes();
    const connection = await this.connection;

    await this.createTable("active_storage_blobs", { id: primaryKeyType }, (t) => {
      t.string("key", { null: false });
      t.string("filename", { null: false });
      t.string("content_type");
      t.text("metadata");
      t.string("service_name", { null: false });
      t.bigint("byte_size", { null: false });
      t.string("checksum");

      if (connection.supportsDatetimeWithPrecision()) {
        t.datetime("created_at", { precision: 6, null: false });
      } else {
        t.datetime("created_at", { null: false });
      }

      t.index(["key"], { unique: true });
    });

    await this.createTable("active_storage_attachments", { id: primaryKeyType }, (t) => {
      t.string("name", { null: false });
      t.references("record", {
        null: false,
        polymorphic: true,
        index: false,
        type: foreignKeyType,
      });
      t.references("blob", { null: false, type: foreignKeyType });

      if (connection.supportsDatetimeWithPrecision()) {
        t.datetime("created_at", { precision: 6, null: false });
      } else {
        t.datetime("created_at", { null: false });
      }

      t.index(["record_type", "record_id", "name", "blob_id"], {
        name: "index_active_storage_attachments_uniqueness",
        unique: true,
      });
      t.foreignKey("active_storage_blobs", { column: "blob_id" });
    });

    await this.createTable("active_storage_variant_records", { id: primaryKeyType }, (t) => {
      t.belongsTo("blob", { null: false, index: false, type: foreignKeyType });
      t.string("variation_digest", { null: false });

      t.index(["blob_id", "variation_digest"], {
        name: "index_active_storage_variant_records_uniqueness",
        unique: true,
      });
      t.foreignKey("active_storage_blobs", { column: "blob_id" });
    });
  }

  /** @internal */
  private primaryAndForeignKeyTypes(): [string, string] {
    const config = TopLevel.Trails!.configuration!.generators();
    const setting = config.options.get(config.orm!())!.primaryKeyType as string | null | undefined;
    const primaryKeyType = setting || "primary_key";
    const foreignKeyType = setting || "bigint";
    return [primaryKeyType, foreignKeyType];
  }
}
