# The file the task-domain connection opened, so /up/ready can see a tasks.db
# REPLACED under it (ProbesController#check_database). Recorded after a query
# has made SQLite open the file; nil without TASKS_DATABASE.
module TasksDatabase
  mattr_accessor :identity

  def self.record!(path)
    stat = File.stat(path)
    self.identity = { path: path, dev: stat.dev, ino: stat.ino }
  end
end

Rails.application.config.after_initialize do
  file = ENV["TASKS_DATABASE"].to_s.strip
  next if file.empty? || Rails.env.test?

  ApplicationRecord.connection_pool.with_connection { |c| c.select_value("SELECT 1") }
  TasksDatabase.record!(file)
end
