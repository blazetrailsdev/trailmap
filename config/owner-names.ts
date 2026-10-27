/**
 * What an owner may be called — the one definition the router and the model
 * both read.
 *
 * It lives in its own module, with NO side effects, because the two consumers
 * cannot import each other: `config/routes.ts` draws the route table when it
 * is imported, so a model importing it would need a registered application
 * just to validate a login, and the model suites would boot the router.
 */

/**
 * The top-level paths that are PAGES, not owners.
 *
 * `/:owner` is drawn last and matches a single segment, so without this every
 * one of these would be ambiguous with an organization of the same name — and,
 * worse, a top-level page added later would be shadowed silently by whichever
 * route happened to be drawn first.
 *
 * GitHub maintains the same list for the same reason: `settings`, `about` and
 * `new` are reserved there, and no account can hold them.
 */
export const RESERVED_OWNER_NAMES = [
  "api",
  "assets",
  "audits",
  "backlog",
  "dashboard",
  "deploys",
  "events",
  "fleet",
  "index",
  "panes",
  "rfc",
  "rfcs",
  "sessions",
  "stories",
  "story",
  "up",
] as const;

/**
 * What a GitHub login may look like: alphanumerics and interior hyphens.
 *
 * `Owner` validates against it and `OWNER_SEGMENT` builds the route constraint
 * from it, so the router and the model cannot drift into disagreeing about
 * what a login is.
 */
export const LOGIN_FORMAT = /[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*/;
