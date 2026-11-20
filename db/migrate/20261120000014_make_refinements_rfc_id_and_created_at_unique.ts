import { Migration } from "@blazetrails/activerecord";

/**
 * `(rfc_id, created_at)` is the import's idempotency key, as
 * `(repo, slug, written_at)` is the audits', so a concurrent post of one
 * report loses to the index instead of storing it twice.
 */
export class MakeRefinementsRfcIdAndCreatedAtUnique extends Migration.get(8) {
  async change() {
    await this.removeIndex("refinements", ["rfc_id", "created_at"]);
    await this.addIndex("refinements", ["rfc_id", "created_at"], { unique: true });
  }
}
