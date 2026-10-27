# The base class of everything in the `hub` database — the GitHub-shaped
# owner/repository hierarchy. PostgreSQL, where the task domain is SQLite.
#
# Rails' connection-per-abstract-class pattern, spelled the Rails way with
# `connects_to`. Nothing joins across the databases: a page that needs both
# runs two queries (see RepoScope).
class Hub < ApplicationRecord
  self.abstract_class = true

  connects_to database: { writing: :hub }
end
