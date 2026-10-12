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
  // and ringo reach this process over plain HTTP on loopback
  // (`TRAILMAP_URL=http://127.0.0.1:<port>`, docs/deploy.md), and `forceSsl`
  // would answer every one of those calls with a 301 to an https:// origin
  // nothing listens on. The public vhost is TLS-terminated and redirected by
  // dokku's nginx (nginx.conf.sigil) before a request gets here, so the
  // redirect this would add is already done where the certificate lives.
  // `assumeSsl` stays off for the same reason: a loopback request IS http.
  this.config.forceSsl = false;

  // Change to "debug" to log everything (including potentially personally-identifiable information!)
  this.config.logLevel = env.RAILS_LOG_LEVEL ?? "info";

  // Prevent health checks from clogging up the logs.
  this.config.silenceHealthcheckPath = "/up";

  this.config.cacheStore = ":memory_store";
});
