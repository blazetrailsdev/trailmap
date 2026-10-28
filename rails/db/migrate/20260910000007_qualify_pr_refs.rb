class QualifyPrRefs < ActiveRecord::Migration[8.0]
  def up
    change_column :stories, :pr, :string
    change_column :events, :pr, :string
  end

  def down
    change_column :stories, :pr, :integer
    change_column :events, :pr, :integer
  end
end
