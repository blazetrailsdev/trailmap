# The refine reports an RFC-refine agent sends when it finishes
# (kind=rfc-refine): one row per report, newest read first by the RFC page's
# Refinements tab.
class CreateRfcRefines < ActiveRecord::Migration[8.0]
  def change
    create_table :rfc_refines do |t|
      t.string :rfc_id, null: false
      t.string :outcome, null: false
      t.text :summary, null: false, default: ""
      t.timestamps

      t.index %i[rfc_id created_at], name: "index_rfc_refines_on_rfc_id_and_created_at"
    end
  end
end
