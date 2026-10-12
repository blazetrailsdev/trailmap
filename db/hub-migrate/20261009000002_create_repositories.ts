import { Migration } from "@blazetrails/activerecord";

export class CreateRepositories extends Migration.get(8) {
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
      // GLOBALLY unique, not unique per owner, and that is deliberate: the
      // ready-queue scope maps a story to a repository through `stories.pr`,
      // which is `repo#N` with no owner in it, so a second `trails` under
      // another owner would silently inherit this one's nine thousand
      // stories. `Repository`'s uniqueness validation says the same thing,
      // but a validation races and `upsert` skips it, so the constraint has
      // to live here for the scope's assumption to actually hold.
      //
      // A per-owner unique index would be implied by this one and is left
      // out; `references` above still indexes `owner_id` for the association.
      //
      // One STRING, not an array: an array element is quoted as a column name
      // ("lower(name)" does not exist), while a string is passed through as
      // the expression it is. Rails' functional indexes work the same way.
      t.index("lower(name)", {
        unique: true,
        name: "index_repositories_on_lower_name",
      });
    });
  }
}
