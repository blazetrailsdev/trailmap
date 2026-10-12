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
});
