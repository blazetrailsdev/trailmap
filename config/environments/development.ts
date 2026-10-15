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

  // NOT adopted from `trails new`: the `tmp/caching-dev.txt` toggle. It reads
  // the file with `node:fs`'s synchronous `existsSync`, which this repo forbids;
  // nothing here does fragment caching for it to switch on.

  // Highlight code that triggered database queries in logs.
  this.config.activeRecord.verboseQueryLogs = true;

  // Append comments with runtime information tags to SQL queries in logs.
  this.config.activeRecord.queryLogTagsEnabled = true;

  // Annotate rendered view with file names.
  this.config.actionView.annotateRenderedViewWithFilenames = true;

  // Raise error when a before_action's only/except options reference missing actions.
  this.config.actionController.raiseOnMissingCallbackActions = true;
});
