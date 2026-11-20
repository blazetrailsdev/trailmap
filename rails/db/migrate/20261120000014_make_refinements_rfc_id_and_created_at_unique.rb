# `(rfc_id, created_at)` is the import's idempotency key, as
# `(repo, slug, written_at)` is the audits', so a concurrent post of one report
# loses to the index instead of storing it twice.
class MakeRefinementsRfcIdAndCreatedAtUnique < ActiveRecord::Migration[8.0]
  def change
    remove_index :refinements, %i[rfc_id created_at]
    add_index :refinements, %i[rfc_id created_at], unique: true
  end
end
