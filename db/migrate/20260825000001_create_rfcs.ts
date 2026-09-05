import { Migration } from "@blazetrails/activerecord";

export class CreateRfcs extends Migration {
  async change() {
    // The RFC slug ("0061-ci-failures") is the natural key — it is what every
    // story's `rfc:` frontmatter field cites — so it is the primary key.
    await this.createTable("rfcs", { id: "string" }, (t) => {
      t.integer("number");
      t.string("slug");
      t.string("title");
      t.string("status", { null: false, default: "draft" });
      t.string("owner");
      t.string("superseded_by");
      t.integer("priority");
      t.string("file_path");
      t.timestamps();
      t.index(["status"]);
    });
  }
}
