class CreateSettings < ActiveRecord::Migration[8.0]
  def change
    create_table :settings, id: :string, primary_key: :key do |t|
      t.text :value
      t.timestamps
    end
  end
end
