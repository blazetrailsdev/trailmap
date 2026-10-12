import { Migration } from "@blazetrails/activerecord";

/**
 * Who may push to a repository — GitHub's Collaborators, under repo settings.
 *
 * A COMPOSITE primary key, `(repository_id, owner_id)`, and that is the point
 * rather than an incidental: an owner is a collaborator on a repository at
 * most once, so the pair IS the identity and a surrogate `id` beside it would
 * be a second answer to the same question. Rails has taken composite keys
 * natively since 7.1, and nothing in trailmap had exercised them.
 *
 * Postgres enforces it as the table's real PRIMARY KEY — not a unique index
 * standing in for one — so the database refuses a duplicate pair whatever the
 * application believes.
 */
export class CreateRepositoryCollaborators extends Migration.get(8) {
  async change() {
    await this.createTable(
      "repository_collaborators",
      { primaryKey: ["repository_id", "owner_id"] },
      (t) => {
        t.references("repository", { null: false, foreignKey: { toTable: "repositories" }, index: false });
        t.references("owner", { null: false, foreignKey: { toTable: "owners" } });
        // GitHub's permission levels, narrowed to the three that mean
        // something here. Identity-mapped, as every enum in this database is.
        t.string("role", { null: false, default: "read" });
        t.timestamps();
      },
    );
  }
}
