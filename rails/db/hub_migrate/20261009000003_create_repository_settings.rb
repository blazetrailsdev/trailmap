class CreateRepositorySettings < ActiveRecord::Migration[8.0]
  def change
    create_table :repository_settings do |t|
      t.references :repository, null: false, index: { unique: true }, foreign_key: { to_table: :repositories }
      t.boolean :issues_enabled, null: false, default: true
      t.boolean :pulls_enabled, null: false, default: true
      t.boolean :actions_enabled, null: false, default: true
      t.boolean :projects_enabled, null: false, default: true
      t.boolean :wiki_enabled, null: false, default: true
      t.boolean :insights_enabled, null: false, default: true
      t.timestamps
    end
  end
end
