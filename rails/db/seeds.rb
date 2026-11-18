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

# A few weeks of parity_days, in development only and only into an empty table,
# so /graphs/parity draws its charts on a box with no STATS_DB. db/seeds.ts
# writes the same rows.
if Rails.env.development? && ParityDay.none?
  now = Time.current
  rows = %w[api test].each_with_index.flat_map do |metric, m|
    %w[activerecord actionpack activesupport].each_with_index.flat_map do |pkg, p|
      (0...21).map do |d|
        total = 1000 + 200 * p
        matched = (total * (0.55 + 0.1 * p + 0.012 * d - 0.05 * m)).round
        gaps = metric == "api" ? { misplaced: 10 + p, missing: total - matched - 10 - p } : nil
        { metric: metric, package: pkg, day: (now - (20 - d).days).to_date, pr_number: 9000 + d, matched: matched,
          total: total, percent: (matched * 10000.0 / total).round / 100.0, gaps: gaps, created_at: now, updated_at: now }
      end
    end
  end
  ParityDay.insert_all(rows)
  puts "seeded #{rows.size} parity_days rows"
end

