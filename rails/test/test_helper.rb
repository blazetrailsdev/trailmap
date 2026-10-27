ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

module ActiveSupport
  class TestCase
    parallelize(workers: :number_of_processors)

    # Rows a test needs, written directly: the task domain has no fixtures
    # because its rows come from `tasks ingest`, never from this app.
    def rfc!(id, status: "active", **attrs)
      Rfc.create!(id: id, title: attrs.delete(:title) || id, status: status, **attrs)
    end

    def story!(id, rfc_id:, status: "ready", deps: [], rfc_deps: [], paths: [], packages: [], **attrs)
      Story.create!(id: id, rfc_id: rfc_id, title: attrs.delete(:title) || id, status: status, **attrs).tap do
        deps.each { |d| StoryDep.create!(story_id: id, depends_on_id: d) }
        rfc_deps.each { |r| StoryRfcDep.create!(story_id: id, rfc_id: r) }
        paths.each { |p| StoryPath.create!(story_id: id, path: p) }
        packages.each { |p| StoryPackage.create!(story_id: id, package: p) }
      end
    end

    # Whether the hub test database is configured; hub tests skip without it,
    # loudly, as the TypeScript suite's do.
    def require_hub!
      skip "HUB_TEST_DATABASE_URL is not set" if ENV["HUB_TEST_DATABASE_URL"].blank?
    end

    def hub_repo!(name, login: "blazetrailsdev", **attrs)
      owner = Owner.find_by_login(login) || Owner.create!(login: login, kind: "organization")
      Repository.create!(owner: owner, name: name, **attrs).tap { |r| RepositorySetting.create!(repository: r) }
    end
  end
end

module ActionDispatch
  class IntegrationTest
    # The JSON API answers loopback only.
    LOOPBACK = { "HTTP_HOST" => "127.0.0.1:3000" }.freeze
  end
end
