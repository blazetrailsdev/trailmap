import { Application } from "@blazetrails/trailties";

// Load the framework trailties this application uses — Rails' `require
// "rails/all"`, and what `trails new` writes here today. trailmap was
// scaffolded the day before the generator gained this line, and ran without
// it: the ActionController, ActionView and ActiveRecord trailties were never
// loaded, so none of their boot initializers ran. The one that matters most
// here is `action_controller.set_helpers_path`, without which `app/helpers`
// is on disk and in `config.helpersPaths` and reaches no view.
import "@blazetrails/trailties/all";

export class Trailmap extends Application {
  static {
    // Initialize configuration defaults for originally generated trails version.
    this.config.loadDefaults("8.0");
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
