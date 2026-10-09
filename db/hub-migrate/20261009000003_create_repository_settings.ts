import { Migration } from "@blazetrails/activerecord";

/**
 * One row per repository, one BOOLEAN COLUMN per optional tab — deliberately
 * not a JSON blob of flags. RFC 0136's whole case against ringo's thirteen
 * state files is that a struct stored as a document cannot be queried,
 * constrained or migrated; a settings table that shipped as `{"issues":true}`
 * in a text column would reproduce exactly that.
 */
export class CreateRepositorySettings extends Migration {
  async change() {
    await this.createTable("repository_settings", (t) => {
      t.references("repository", {
        null: false,
        index: { unique: true },
        foreignKey: { toTable: "repositories" },
      });
      // Opt-OUT: every tab is on until someone turns it off, which is how
      // GitHub's Features checkboxes behave and what `ALL_TABS_ENABLED`
      // assumes for a repository whose row has not been written yet.
      t.boolean("issues_enabled", { null: false, default: true });
      t.boolean("pulls_enabled", { null: false, default: true });
      t.boolean("actions_enabled", { null: false, default: true });
      t.boolean("projects_enabled", { null: false, default: true });
      t.boolean("wiki_enabled", { null: false, default: true });
      t.boolean("insights_enabled", { null: false, default: true });
      t.timestamps();
    });
  }
}
