class AddBodyToDocuments < ActiveRecord::Migration[8.0]
  def change
    add_column :stories, :body, :text
    add_column :rfcs, :body, :text
  end
end
