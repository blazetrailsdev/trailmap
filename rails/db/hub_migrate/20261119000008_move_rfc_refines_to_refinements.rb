# RFC 0243, Decision 1: the refine reports move off the hub. Every
# `rfc_refines` row becomes an RfcRefinement on Base, its summary attached and its
# timestamps kept, and the hub table is dropped. `down` recreates the hub
# table as 20261117000007 made it and moves the rows back.
class MoveRfcRefinesToRefinements < ActiveRecord::Migration[8.0]
  def up
    select_all("SELECT rfc_id, outcome, summary, created_at, updated_at FROM rfc_refines ORDER BY id").each do |row|
      refinement = RfcRefinement.create!(row.slice("rfc_id", "outcome", "created_at", "updated_at"))
      refinement.summary.attach(io: StringIO.new(row["summary"]), filename: "summary.md", content_type: "text/markdown")
      # The attachment touches its record.
      refinement.update_column(:updated_at, row["updated_at"])
    end
    drop_table :rfc_refines
  end

  def down
    create_table :rfc_refines do |t|
      t.string :rfc_id, null: false
      t.string :outcome, null: false
      t.text :summary, null: false, default: ""
      t.timestamps

      t.index %i[rfc_id created_at], name: "index_rfc_refines_on_rfc_id_and_created_at"
    end
    RfcRefinement.order(:id).each do |refinement|
      summary = refinement.summary.attached? ? refinement.summary.download.force_encoding(Encoding::UTF_8) : ""
      values = [refinement.rfc_id, refinement.outcome, summary, refinement.created_at, refinement.updated_at]
      execute "INSERT INTO rfc_refines (rfc_id, outcome, summary, created_at, updated_at) " \
              "VALUES (#{values.map { |v| connection.quote(v) }.join(", ")})"
      refinement.summary.purge
      refinement.destroy!
    end
  end
end
