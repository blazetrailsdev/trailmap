# The audit reports (RFC 0243): the body is an Active Storage attachment.
class CreateAudits < ActiveRecord::Migration[8.0]
  def change
    create_table :audits do |t|
      t.string :slug, null: false
      t.string :title
      t.string :format
      t.string :repo
      t.datetime :written_at, null: false
      t.timestamps

      t.index %i[repo slug written_at], unique: true
    end
  end
end
