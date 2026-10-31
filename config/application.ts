import { Logger } from "@blazetrails/activesupport";
import { env, stdout } from "@blazetrails/ruby-compat";
import { Application } from "@blazetrails/trailties";

// Load the framework trailties this application uses — Rails' `require
// "rails/all"`, and what `trails new` writes here today. trailmap was
// scaffolded the day before the generator gained this line, and ran without
// it: the ActionController, ActionView and ActiveRecord trailties were never
// loaded, so none of their boot initializers ran. The one that matters most
// here is `action_controller.set_helpers_path`, without which `app/helpers`
// is on disk and in `config.helpersPaths` and reaches no view.
import "@blazetrails/trailties/all";

// Solid Queue's engine: Rails loads it through `Bundler.require`, and its
// initializers are what point `SolidQueue::Record` at the `queue` database
// (config/environments/production.ts, config/database.ts).
import "@blazetrails/solid-queue";

export class Trailmap extends Application {
  static {
    // Initialize configuration defaults for originally generated trails version.
    this.config.loadDefaults("8.0");

    // trailmap's own settings, read from the environment ONCE, here. Their
    // readers (config/fleet.ts, config/tasks-content.ts) take them from
    // `config.x` and never from `env`, so a test or a console sets the
    // setting rather than the process's environment. `TASKS_DATABASE` is NOT
    // here: config/database.ts owns it, and is its only reader.
    this.config.x.fleet.repoPaths = env.FLEET_REPO_PATHS;
    this.config.x.tasks.dir = env.TASKS_DIR;
    this.config.x.audits.dir = env.AUDITS_DIR;
    this.config.x.deploys.logsDir = env.DEPLOY_LOGS_DIR;

    // Log to STDOUT, as Rails' production template does, in every environment:
    // without a logger the framework installs a NullLogger, and what the
    // models report through `Trails.logger` (an RFC auto-closing) is dropped.
    this.config.logger = new Logger(stdout);
  }

  // Configuration for the application, engines, and trailties goes here.
  //
  // These settings can be overridden in specific environments using the files
  // in config/environments, which are processed later.
  //
  // config.timeZone = "Central Time (US & Canada)";
  // config.eagerLoadPaths.push("extras");
  // config
}

Application.register(Trailmap);

declare module "@blazetrails/trailties" {
  interface ApplicationRegistry {
    application: Trailmap;
  }
}
