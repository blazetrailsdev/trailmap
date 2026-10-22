/**
 * The shared-SQLite write protocol: ONE writer per table, not per file.
 *
 * `docs/write-protocol.md` is the prose; these are the values. trailmap's
 * connection takes them from `tasksDatabaseConfig()`. ringo is Go in another
 * repository and cannot import this, so test/config/write-protocol.test.ts
 * reads every `sql.Open` in ringo's vendored database code (vendor/ringo/db)
 * and fails when its DSN or its SQL writes break the protocol.
 */

export type Owner = "trailmap" | "ringo";

export const writeProtocol = {
  /**
   * Readers never block the writer, and the writer never blocks readers. A
   * persistent property of the FILE, set by trailmap's writable connection; a
   * `mode=ro` connection such as ringo's cannot change it and inherits it.
   */
  journalMode: "WAL",
  /**
   * How long a connection waits on another process's write lock before
   * `SQLITE_BUSY`. Every write either process makes is a single short
   * transaction (one verb, one webhook row), so 5s is two orders of magnitude
   * above a real write and still well under dokku's 60s request timeout.
   */
  busyTimeoutMs: 5000,
} as const;

/** The pragma every ringo `sql.Open` DSN must carry. */
export const ringoBusyTimeoutPragma = `_pragma=busy_timeout(${writeProtocol.busyTimeoutMs})`;

/**
 * Every table in `db/schema.ts`, and the only process that may write it. The
 * other process may read every table. Migrations for all of them — ringo's
 * included — live in trailmap's `db/migrate`.
 *
 * The `hub` database is NOT here and does not belong here: it is Postgres
 * (config/database.ts, app/models/hub.ts), ringo has no handle on it, and one
 * writer per table is a rule about a file two processes open. `db/hub-migrate`
 * is its history, and `db/hub_schema.ts` its schema.
 */
export const tableOwners: Record<string, Owner> = {
  events: "trailmap",
  meta: "trailmap",
  // ringo's PR tracker, in place of tracker-state.json. trailmap reads it.
  pr_states: "ringo",
  rfcs: "trailmap",
  stories: "trailmap",
  story_deps: "trailmap",
  story_packages: "trailmap",
  story_paths: "trailmap",
  story_rfc_deps: "trailmap",
};

export function tablesOwnedBy(owner: Owner): string[] {
  return Object.keys(tableOwners).filter((table) => tableOwners[table] === owner);
}
