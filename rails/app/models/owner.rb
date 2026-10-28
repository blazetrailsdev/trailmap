# A user or an organization — the root of the URL space, as on GitHub.
# `login` is the natural key but not the primary key: logins get renamed.
class Owner < Hub
  # The top-level paths that are PAGES, not owners. The router's `:owner`
  # constraint and this model share them, so the two cannot drift.
  RESERVED_NAMES = %w[api assets audits backlog dashboard deploys events fleet index panes rfc rfcs sessions stories story up].freeze

  # A GitHub login: alphanumerics and interior single hyphens.
  LOGIN_FORMAT = /[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*/

  has_many :repositories, inverse_of: :owner, dependent: :destroy
  has_many :collaborations, class_name: "RepositoryCollaborator", inverse_of: :owner, dependent: :delete_all

  enum :kind, { user: "user", organization: "organization" }

  validates :login, presence: true, uniqueness: { case_sensitive: false },
                    format: { with: /\A#{LOGIN_FORMAT.source}\z/ }, length: { maximum: 39 }
  validates :kind, presence: true
  # Reserved IN EVERY CASE: `Dashboard` must not slip past as `dashboard` does not.
  validate { errors.add(:login, "is reserved by a trailmap page") if RESERVED_NAMES.include?(login.to_s.downcase) }

  def self.find_by_login(login)
    where(arel_table[:login].lower.eq(login.downcase)).first
  end

  # The display name when there is one, else the login.
  def title
    display_name || login
  end

  def to_param
    login
  end
end
