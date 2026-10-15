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

  // Configure public file server for tests with cache-control for performance.
  this.config.publicFileServer.headers = { "cache-control": "public, max-age=3600" };

  // Print deprecation notices to the stderr.
  this.config.activeSupport.deprecation = "stderr";

  // Raise error when a before_action's only/except options reference missing actions.
  this.config.actionController.raiseOnMissingCallbackActions = true;
});
