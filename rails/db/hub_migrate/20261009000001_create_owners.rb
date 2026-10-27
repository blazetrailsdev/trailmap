class CreateOwners < ActiveRecord::Migration[8.0]
  def change
    create_table :owners do |t|
      t.string :login, null: false
      t.string :kind, null: false, default: "organization"
      t.string :display_name
      t.text :description
      t.timestamps
      t.index "lower(login)", unique: true, name: "index_owners_on_lower_login"
      t.index :kind
    end
  end
end
