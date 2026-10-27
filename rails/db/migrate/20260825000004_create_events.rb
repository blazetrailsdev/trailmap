class CreateEvents < ActiveRecord::Migration[8.0]
  def change
    create_table :events do |t|
      t.string :at, null: false
      t.string :verb, null: false
      t.string :story_id
      t.string :rfc_id
      t.integer :pr
      t.string :actor
      t.text :detail
      t.index :at
      t.index :verb
      t.index :story_id
      t.index :rfc_id
    end
  end
end
