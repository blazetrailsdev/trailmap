# A repository's feature switches — GitHub's Settings → Features. A disabled
# tab is a 404. Code and settings have no switch.
class RepositorySetting < Hub
  OPTIONAL_TABS = %w[issues pulls actions projects wiki insights].freeze

  # The switches of a repository with no row: everything on.
  ALL_ENABLED = Object.new.tap { |o| def o.enabled?(_tab) = true }.freeze

  belongs_to :repository
  validates :repository_id, presence: true, uniqueness: true

  # An unknown tab is ON: the switches are an opt-OUT.
  def enabled?(tab)
    return true unless OPTIONAL_TABS.include?(tab.to_s)
    public_send(:"#{tab}_enabled")
  end
end
