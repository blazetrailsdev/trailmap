# The refine reports (RFC 0243, Decision 1): the summary is an Active Storage
# attachment.
class CreateRefinements < ActiveRecord::Migration[8.0]
  def change
    create_table :refinements do |t|
      t.string :rfc_id, null: false
      t.string :outcome, null: false
      t.integer :stories
      t.timestamps

      t.index %i[rfc_id created_at]
    end
  end
end
