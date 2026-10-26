class CreateRepositories < ActiveRecord::Migration[8.0]
  def change
    create_table :repositories do |t|
      t.references :owner, null: false, foreign_key: { to_table: :owners }
      t.string :name, null: false
      t.string :checkout_path
      t.string :default_branch, null: false, default: "main"
      t.string :visibility, null: false, default: "public"
      t.text :description
      t.boolean :archived, null: false, default: false
      t.timestamps
      t.index "lower(name)", unique: true, name: "index_repositories_on_lower_name"
    end
  end
end
