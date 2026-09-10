import { Migration } from "@blazetrails/activerecord";

/**
 * `pr` is a `repo#N` string (`trails#7228`, `tasks#94`), matching the tasks
 * CLI's migration of the same version: PR numbers from trails, tasks and
 * trailmap collide, so a bare integer no longer says which PR it is.
 *
 * Same version as the CLI's so the two schemas stay one history. The CLI's
 * migration also backfills the live database's existing values; this one only
 * changes the column type, because trailmap never migrates that database
 * (config/database.ts) — only its own.
 */
export class QualifyPrRefs extends Migration {
  async up() {
    await this.changeColumn("stories", "pr", "string");
    await this.changeColumn("events", "pr", "string");
  }

  async down() {
    await this.changeColumn("stories", "pr", "integer");
    await this.changeColumn("events", "pr", "integer");
  }
}
