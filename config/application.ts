import { Application } from "@blazetrails/trailties";

interface LoadsDefaults {
  loadDefaults(targetVersion: string): void;
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
