class CreateStories < ActiveRecord::Migration[8.0]
  def change
    create_table :stories, id: :string do |t|
      t.string :rfc_id, null: false
      t.string :title
      t.string :cluster
      t.integer :priority
      t.integer :est_loc
      t.string :file_path

      t.string :status, null: false, default: "draft"
      t.integer :pr
      t.string :assignee
      t.string :blocked_by
      t.text :closed_reason
      t.string :claim_at

      t.timestamps

      t.index :status
      t.index [ :rfc_id, :status ]
    end
  end
end
