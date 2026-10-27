# The `hub` database's seeds: the owner and the repositories the fleet works
# on. Nothing seeds the task domain — those rows come from `tasks ingest`.
# Idempotent: this is also how a box's repo list is refreshed after
# FLEET_REPO_PATHS changes. Bang forms throughout, so a refused row says so.
owner = Owner.find_by_login("blazetrailsdev") ||
  Owner.create!(login: "blazetrailsdev", kind: "organization", display_name: "Blaze Trails",
                description: "trails, the task system, and the fleet that builds them.")

known = [
  [ "trails", "The framework. Rails, in TypeScript." ],
  [ "trailmap", "The task domain as a trails application — this app." ],
  [ RepoScope::CONTENT_REPO, "RFCs, stories and the CLI that ingests them." ],
  [ "ringo", "The fleet's webhook process and dashboard." ]
]
known.each do |name, description|
  if (existing = Repository.find_by_nwo(owner.login, name))
    # Only FILLS a blank description; never overwrites one.
    existing.update!(description: description) if existing.description.blank?
    next
  end
  repo = Repository.create!(owner: owner, name: name, description: description)
  RepositorySetting.create!(repository: repo)
end

admin_login = ENV["SEED_ADMIN_LOGIN"].to_s.strip.presence || "dean"
admin_name = ENV["SEED_ADMIN_NAME"].to_s.strip.presence || "Dean Marano"
admin = Owner.find_by_login(admin_login) || Owner.create!(login: admin_login, kind: "user", display_name: admin_name)
owner.repositories.each do |repo|
  RepositoryCollaborator.find_or_create_by!(repository: repo, owner: admin) { |c| c.role = "admin" }
end

imported = Repository.import_fleet_repos
puts "seeded #{owner.login}: #{known.size} repositories, #{imported.size} from FLEET_REPO_PATHS"
