class CreatePrStates < ActiveRecord::Migration[8.0]
  def change
    create_table :pr_states, primary_key: %i[owner repo pr] do |t|
      t.string :owner, null: false
      t.string :repo, null: false
      t.integer :pr, null: false
      t.string :branch, null: false, default: ""
      t.string :title, null: false, default: ""
      t.text :labels, null: false, default: ""
      t.boolean :draft, null: false, default: false
      t.boolean :merge_conflict, null: false, default: false
      t.boolean :behind, null: false, default: false
      t.integer :comment_count, null: false, default: 0
      t.integer :review_cycles, null: false, default: 0
      t.integer :open_findings, null: false, default: 0
      t.boolean :open_findings_known, null: false, default: false
      t.string :pane_status, null: false, default: ""
      t.string :ci_status, null: false, default: ""
      t.string :last_action, null: false, default: ""
      t.string :last_time, null: false, default: ""
      t.string :next_action, null: false, default: ""
      t.string :pane, null: false, default: ""
      t.boolean :pane_manual, null: false, default: false
      t.boolean :notified, null: false, default: false
      t.boolean :ci_failure_notified, null: false, default: false
      t.boolean :ci_success_notified, null: false, default: false
      t.boolean :cycles_exhausted_notified, null: false, default: false
      t.string :closed_seen_at, null: false, default: ""
      t.boolean :merged, null: false, default: false
      t.string :teardown_at, null: false, default: ""
      t.boolean :merged_checked, null: false, default: false
      t.index :pane
    end
  end
end
