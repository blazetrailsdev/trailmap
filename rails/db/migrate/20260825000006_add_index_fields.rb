class AddIndexFields < ActiveRecord::Migration[8.0]
  def change
    add_column :stories, :updated_on, :string

    add_column :rfcs, :created_on, :string
    add_column :rfcs, :updated_on, :string
    add_column :rfcs, :packages, :text
    add_column :rfcs, :clusters, :text
    add_column :rfcs, :related_rfcs, :text
  end
end
