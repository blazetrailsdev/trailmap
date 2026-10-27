class CreateRfcs < ActiveRecord::Migration[8.0]
  def change
    create_table :rfcs, id: :string do |t|
      t.integer :number
      t.string :slug
      t.string :title
      t.string :status, null: false, default: "draft"
      t.string :owner
      t.string :superseded_by
      t.integer :priority
      t.string :file_path
      t.timestamps
      t.index :status
    end
  end
end
