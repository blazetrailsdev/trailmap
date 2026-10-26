class CreateRepositoryCollaborators < ActiveRecord::Migration[8.0]
  def change
    create_table :repository_collaborators, primary_key: %i[repository_id owner_id] do |t|
      t.references :repository, null: false, foreign_key: { to_table: :repositories }, index: false
      t.references :owner, null: false, foreign_key: { to_table: :owners }
      t.string :role, null: false, default: "read"
      t.timestamps
    end
  end
end
