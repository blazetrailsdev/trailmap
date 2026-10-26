# Key/value watermarks. `last_ingested_sha` makes `tasks ingest` incremental.
class Meta < ApplicationRecord
  self.table_name = "meta"
  self.primary_key = "key"

  def self.get(key)
    find_by(key: key)&.value
  end

  def self.set(key, value)
    find_or_initialize_by(key: key).update!(value: value)
  end
end
