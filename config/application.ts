import { Application } from "@blazetrails/trailties";

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
