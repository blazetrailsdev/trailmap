import { env } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

Trails.application!.configure(function () {
  // Settings specified here will take precedence over those in config/application.ts.

  // Code is not reloaded between requests.
  this.config.enableReloading = false;

  // Eager load code on boot for better performance and memory savings.
  this.config.eagerLoad = true;

  // Full error reports are disabled.
  this.config.considerAllRequestsLocal = false;

  // NOT forced, deliberately — `trails new` writes `true` here. The tasks CLI
  // and ringo reach this process over plain HTTP on loopback (docs/deploy.md),
  // and `forceSsl` would answer each call with a 301 to an https:// origin
  // nothing listens on. dokku's nginx terminates TLS and redirects the public
  // vhost (nginx.conf.sigil) before a request gets here.
  // `assumeSsl` is off for the same reason: a loopback request IS http.
  this.config.assumeSsl = false;
  this.config.forceSsl = false;

  // NOT adopted from `trails new`: `logTags` and the `TaggedLogging` logger,
  // which the template builds from `process.stdout`. config/application.ts's stays.

  // Cache digest-stamped assets in public/ for far-future expiry.
  //
  // As in Rails (railties v8.0.2 `production.rb.tt:20-21`), the header covers
  // every file in public/, not only public/assets: the error pages,
  // favicon.ico and robots.txt too. Rails accepts that for those files, and
  // so does this app. The consequence is that a changed favicon or robots.txt
  // can sit in a browser's cache for up to a year. The pages people read are
  // rendered, not static, and every asset they link is hashed by `vite build`.
  this.config.publicFileServer.headers = { "cache-control": "public, max-age=31556952" };

  // Change to "debug" to log everything (including potentially personally-identifiable information!)
  this.config.logLevel = env.RAILS_LOG_LEVEL ?? "info";

  // Prevent health checks from clogging up the logs.
  this.config.silenceHealthcheckPath = "/up";

  this.config.cacheStore = ":memory_store";

  // Replace the default in-process and non-durable queuing backend for Active Job.
  this.config.activeJob.queueAdapter = "solid_queue";
  this.config.solidQueue.connectsTo = { database: { writing: ":queue" } };

  // Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  // the I18n.defaultLocale when a translation cannot be found).
  this.config.i18n.fallbacks = true;

  // Do not dump schema after migrations.
  this.config.activeRecord.dumpSchemaAfterMigration = false;

  // Only use "id" for inspections in production.
  this.config.activeRecord.attributesForInspect = ["id"];
});
