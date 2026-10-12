import { Trails } from "@blazetrails/trailties";

Trails.application!.configure(function () {
  // Settings specified here will take precedence over those in config/application.ts.

  // While tests run files are not watched, reloading is not necessary.
  this.config.enableReloading = false;

  // The suite imports what it tests; nothing needs the whole tree loaded.
  this.config.eagerLoad = false;

  // Show full error reports.
  this.config.considerAllRequestsLocal = true;
  this.config.cacheStore = ":null_store";

  // Render exception templates for rescuable exceptions and raise for other exceptions.
  this.config.actionDispatch.showExceptions = "rescuable";

  // Disable request forgery protection in test environment.
  this.config.actionController.allowForgeryProtection = false;

  // The rest of `trails new`'s test environment is deliberately not adopted.
});
