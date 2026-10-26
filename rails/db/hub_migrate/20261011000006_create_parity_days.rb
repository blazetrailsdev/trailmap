class CreateParityDays < ActiveRecord::Migration[8.0]
  def change
    create_table :parity_days do |t|
      t.string :metric, null: false
      t.string :package, null: false
      t.date :day, null: false
      t.integer :pr_number, null: false
      t.integer :matched, null: false
      t.integer :total, null: false
      t.decimal :percent, precision: 5, scale: 2, null: false
      t.jsonb :gaps
      t.timestamps

      t.index %i[metric package day], name: "index_parity_days_on_metric_and_package_and_day", unique: true
      t.index %i[metric day], name: "index_parity_days_on_metric_and_day"
    end

    add_check_constraint :parity_days, "matched <= total", name: "parity_days_matched_within_total"
    add_check_constraint :parity_days, "percent >= 0 AND percent <= 100", name: "parity_days_percent_is_a_percentage"
    add_check_constraint :parity_days, "total >= 0 AND matched >= 0", name: "parity_days_counts_are_not_negative"
  end
end
