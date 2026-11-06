# `package_meta`, for the TEST environment only, as the stats sync writes it.
# Mirrors ../../test/models/stats-schema.ts.
class CreatePackageMeta < ActiveRecord::Migration[8.0]
  def change
    create_table :package_meta do |t|
      t.string :merge_commit_sha
      t.integer :pr_number
      t.string :package
      t.string :rails_counterpart
      t.text :description
      t.string :claude_md
    end
  end
end
