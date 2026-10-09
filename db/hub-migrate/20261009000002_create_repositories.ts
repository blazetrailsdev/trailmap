import { Migration } from "@blazetrails/activerecord";

export class CreateRepositories extends Migration {
  async change() {
    await this.createTable("repositories", (t) => {
      // `references` gives the column, the index and — Postgres being a
      // database that enforces them — a real foreign key, which is the point
      // of this table being here rather than in the SQLite domain file.
      t.references("owner", { null: false, foreignKey: { toTable: "owners" } });
      t.string("name", { null: false });
      t.string("checkout_path");
      t.string("default_branch", { null: false, default: "main" });
      t.string("visibility", { null: false, default: "public" });
      t.text("description");
      t.boolean("archived", { null: false, default: false });
      t.timestamps();
      // One STRING, not an array: an array element is quoted as a column name
      // ("lower(name)" does not exist), while a string is passed through as
      // the expression it is. Rails' functional indexes work the same way.
      t.index("owner_id, lower(name)", {
        unique: true,
        name: "index_repositories_on_owner_id_and_lower_name",
      });
    });
  }
}
