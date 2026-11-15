class AddStageToStories < ActiveRecord::Migration[8.0]
  def change
    add_column :stories, :stage, :string
  end
end
