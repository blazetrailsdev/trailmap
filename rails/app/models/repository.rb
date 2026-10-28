# One repository under an owner: `/blazetrailsdev/trails` and its tabs.
# FLEET_REPO_PATHS is the bootstrap source (`import_fleet_repos`); the rows
# are what the application reads.
class Repository < Hub
  FleetRepo = Struct.new(:name, :path)

  belongs_to :owner
  # `settings`, never `setting`, as in the TypeScript app.
  has_one :settings, class_name: "RepositorySetting", dependent: :destroy
  has_many :collaborators, class_name: "RepositoryCollaborator", inverse_of: :repository, dependent: :delete_all

  enum :visibility, { public: "public", private: "private" }, prefix: true

  # Name unique across ALL owners: RepoScope keys on bare names.
  validates :name, presence: true, uniqueness: { case_sensitive: false },
                   format: { with: /\A[a-zA-Z0-9][a-zA-Z0-9._-]*\z/ }, length: { maximum: 100 }
  validates :default_branch, presence: true

  def name_with_owner
    "#{owner&.login || owner_id}/#{name}"
  end

  def to_param
    name
  end

  # THE visibility rule. A public repository is everyone's.
  def readable_by?(viewer)
    return true if visibility_public?
    return false if viewer.nil?
    return true if viewer.id == owner_id
    RepositoryCollaborator.exists?(repository_id: id, owner_id: viewer.id)
  end

  # The repository `/:owner/:repo` names, owner and settings loaded.
  def self.find_by_nwo(login, name)
    owner = Owner.find_by_login(login) or return nil
    repo = where(owner_id: owner.id).where(arel_table[:name].lower.eq(name.downcase)).includes(:settings).first
    repo&.tap { |r| r.owner = owner }
  end

  # FLEET_REPO_PATHS, `owner/repo=/path`, comma-separated, sorted by name.
  def self.fleet_repos
    raw = Rails.configuration.x.fleet.repo_paths.to_s.strip
    repos = raw.split(",").filter_map do |entry|
      name, path = entry.split("=", 2).map { |s| s.to_s.strip }
      FleetRepo.new(name, path) if entry.include?("=") && name.present? && path.present?
    end
    repos.sort_by(&:name)
  end

  # The rows with a checkout, merged by name over FLEET_REPO_PATHS.
  def self.spawn_choices
    by_name = fleet_repos.index_by(&:name)
    checkouts_or_none.each { |r| by_name[r.name] = r }
    by_name.values.sort_by(&:name)
  end

  def self.checkouts_or_none
    where(archived: false).where.not(checkout_path: [ nil, "" ]).includes(:owner)
      .map { |r| FleetRepo.new(r.name_with_owner, r.checkout_path) }
  rescue ActiveRecord::ConnectionNotEstablished, ActiveRecord::ConnectionNotDefined
    []
  end

  # Upsert the repositories FLEET_REPO_PATHS describes; never deletes.
  def self.import_fleet_repos
    fleet_repos.filter_map do |entry|
      login, name = entry.name.split("/", 2).map { |s| s.to_s.strip }
      next if login.blank? || name.blank?
      owner = Owner.find_by_login(login) || Owner.create!(login: login, kind: "organization")
      if (existing = find_by_nwo(login, name))
        existing.update!(checkout_path: entry.path)
        next existing
      end
      create!(owner: owner, name: name, checkout_path: entry.path).tap { |r| RepositorySetting.create!(repository: r) }
    end
  end
end
