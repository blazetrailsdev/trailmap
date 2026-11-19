# RFC 0243, Decision 1: the refine reports move off the hub, onto Base as
# Refinement records. This drops the hub's `rfc_refines`.
#
# It does NOT copy rows to Base, and cannot: `db:migrate` runs each database's
# migrations inside DatabaseTasks.with_temporary_pool, which re-establishes
# ActiveRecord::Base itself on that database, so in a hub migration every Base
# model (Active Storage's included) is on the hub Postgres. No hub had a row
# when this shipped; one that does refuses to migrate rather than lose them.
class MoveRfcRefinesToRefinements < ActiveRecord::Migration[8.0]
  def up
    count = select_value("SELECT COUNT(*) FROM rfc_refines").to_i
    if count.positive?
      raise "rfc_refines holds #{count} row(s); this migration drops it and cannot move them to Base " \
            "(Base is the hub's connection while hub migrations run). Move them first."
    end
    drop_table :rfc_refines
  end

  # The hub table as 20261117000007 made it, empty.
  def down
    create_table :rfc_refines do |t|
      t.string :rfc_id, null: false
      t.string :outcome, null: false
      t.text :summary, null: false, default: ""
      t.timestamps

      t.index %i[rfc_id created_at], name: "index_rfc_refines_on_rfc_id_and_created_at"
    end
  end
end
