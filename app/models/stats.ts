import { Base } from "@blazetrails/activerecord";

/**
 * The base class of everything that lives in the trails stats database — the
 * per-package comparison results the nightly stats-sync cron parses out of
 * every merged trails PR's CI logs, and the `pull_requests` rows that date
 * them.
 *
 * The third connection in this process, and the third adapter: the task domain
 * is better-sqlite3 on `ActiveRecord::Base` itself, the hub is PostgreSQL on
 * `Hub`, and this is `node-sqlite` on `Stats`. Same pattern as `Hub`
 * (app/models/hub.ts, which has the long version of why it is
 * `establishConnection` from an initializer rather than `connectsTo`) — a pool
 * is keyed by the connection specification name, and each of the three has its
 * own, so none of them disturbs the others.
 *
 * READ-ONLY, and enforced at the driver: `statsDatabaseConfig()` passes
 * `readonly: true`, so SQLite refuses a write on this connection. trailmap does
 * not own this schema — the cron does — and nothing here should ever write it.
 *
 * Nothing joins across the three databases, and nothing can. The parity page
 * needs no such join: every row it charts, including the merge dates, is in
 * this one database.
 */
export class Stats extends Base {
  static {
    // ASSIGNED in a static block, never `static abstractClass = true` — see
    // the long note in app/models/hub.ts. A class field shadows the library's
    // accessor with an own data property, static data properties ARE
    // inherited, and every subclass then reads `abstractClass === true` and
    // raises "X is an abstract class and cannot be instantiated" on create.
    this.abstractClass = true;
  }
}
