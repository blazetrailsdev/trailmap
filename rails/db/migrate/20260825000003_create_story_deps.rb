class CreateStoryDeps < ActiveRecord::Migration[8.0]
  def change
    create_table :story_deps, id: false do |t|
      t.string :story_id, null: false
      t.string :depends_on_id, null: false
      t.index :story_id
      t.index :depends_on_id
      t.index [ :story_id, :depends_on_id ], unique: true
    end

    create_table :story_rfc_deps, id: false do |t|
      t.string :story_id, null: false
      t.string :rfc_id, null: false
      t.index :story_id
      t.index [ :story_id, :rfc_id ], unique: true
    end

    create_table :story_paths, id: false do |t|
      t.string :story_id, null: false
      t.string :path, null: false
      t.index :story_id
      t.index :path
    end

    create_table :story_packages, id: false do |t|
      t.string :story_id, null: false
      t.string :package, null: false
      t.index :story_id
      t.index :package
    end
  end
end
