import { Trails } from "@blazetrails/trailties";

Trails.application!.configure(function () {
  // Settings specified here will take precedence over those in config/application.ts.

  // Make code changes take effect immediately without server restart.
  this.config.enableReloading = true;

  // Do not eager load code on boot.
  this.config.eagerLoad = false;

  // Show full error reports.
  this.config.considerAllRequestsLocal = true;

  // Enable server timing.
  this.config.serverTiming = true;

  // Change to :null_store to avoid any caching.
  this.config.cacheStore = ":memory_store";
});
