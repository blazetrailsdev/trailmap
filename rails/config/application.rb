require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_view/railtie"
require "rails/test_unit/railtie"

Bundler.require(*Rails.groups)

module Trailmap
  class Application < Rails::Application
    config.load_defaults 8.0

    config.autoload_lib(ignore: %w[assets tasks])

    # trailmap's own settings, read from the environment ONCE, here; their
    # readers take them from `config.x`. TASKS_DATABASE is database.yml's.
    config.x.fleet.repo_paths = ENV["FLEET_REPO_PATHS"]
    config.x.tasks.dir = ENV["TASKS_DIR"]
    config.x.audits.dir = ENV["AUDITS_DIR"]
    config.x.deploys.logs_dir = ENV["DEPLOY_LOGS_DIR"]

    # ringo's chart engine, vendored by ../scripts/vendor-ringo.sh.
    config.assets.paths << Rails.root.join("vendor/ringo")

    # Log to STDOUT in every environment, as the TypeScript app does.
    config.logger = ActiveSupport::Logger.new($stdout)
  end
end
