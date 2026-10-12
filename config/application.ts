import { Logger } from "@blazetrails/activesupport";
import { stdout } from "@blazetrails/ruby-compat";
import { Application } from "@blazetrails/trailties";

// Load the framework trailties this application uses — Rails' `require
// "rails/all"`, and what `trails new` writes here today. trailmap was
// scaffolded the day before the generator gained this line, and ran without
// it: the ActionController, ActionView and ActiveRecord trailties were never
// loaded, so none of their boot initializers ran. The one that matters most
// here is `action_controller.set_helpers_path`, without which `app/helpers`
// is on disk and in `config.helpersPaths` and reaches no view.
import "@blazetrails/trailties/all";

interface LoadsDefaults {
  loadDefaults(targetVersion: string | number): void;
}

export class Trailmap extends Application {
  static {
    // Initialize configuration defaults for originally generated trails version.
    //
    // `Trailtie.config` is typed as the trailtie configuration, which has no
    // `loadDefaults` — only `Application`'s own configuration does, and the
    // static accessor is not narrowed for it. The value here is an
    // application configuration at runtime, so the cast records a framework
    // typing gap rather than a behaviour change.
    (this.config as unknown as LoadsDefaults).loadDefaults("8.0");

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
