// Be sure to restart your server when you modify this file.

import * as Sentry from "@sentry/node";
import { Trails } from "@blazetrails/trailties";

// Errors go to Bugsink, which speaks the Sentry protocol, when SENTRY_DSN is
// set. The DSN names bugsink.web on the dokku `fleet` network, past the SSO
// that guards Bugsink's public URL. Unset (development, tests), nothing is
// sent and nothing is subscribed.
//
// Sentry's own handlers catch uncaught exceptions and unhandled rejections.
// Everything else arrives through `Trails.error`, as in Rails: the executor
// middleware reports a request's unhandled error there, and so does any
// `Trails.error.report(...)` the app makes. Tracing is off; this is errors only.
const dsn = process.env["SENTRY_DSN"];
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env["NODE_ENV"] ?? "production",
    release: process.env["GIT_REV"],
    sendDefaultPii: false,
  });

  Trails.error.subscribe({
    report(error, { handled, severity, context, source }) {
      Sentry.withScope((scope) => {
        scope.setLevel(severity === "warning" ? "warning" : severity === "info" ? "info" : "error");
        scope.setTag("source", source);
        scope.setTag("handled", String(handled));
        if (Object.keys(context).length > 0) scope.setContext("trails", context);
        Sentry.captureException(error);
      });
    },
  });
}
