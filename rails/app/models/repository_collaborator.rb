# An owner's access to a repository. THE composite primary key here:
# `(repository_id, owner_id)` is the identity, enforced by the database.
class RepositoryCollaborator < Hub
  self.primary_key = %i[repository_id owner_id]

  belongs_to :repository
  belongs_to :owner

  enum :role, { read: "read", write: "write", admin: "admin" }, prefix: true

  validates :role, presence: true

  # `write` and `admin` may push; `read` may not.
  def can_push?
    !role_read?
  end
end
