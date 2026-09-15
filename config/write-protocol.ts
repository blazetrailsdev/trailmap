/**
 * The shared-SQLite write protocol: ONE writer per table, not per file.
 *
 * `docs/write-protocol.md` is the prose; this is the value both processes
 * read, so WAL and the busy timeout are stated once. trailmap's connection
 * takes them from `tasksDatabaseConfig()`; ringo opens the same file with
 * `ringoDsnPragmas` and the ownership test (test/config/write-protocol.test.ts)
 * fails if the two drift apart or a table gains a second writer.
 */

export type Owner = "trailmap" | "ringo";

export const writeProtocol = {
  /** Readers never block the writer, and the writer never blocks readers. */
  journalMode: "WAL",
  /**
   * How long a connection waits on another process's write lock before
   * `SQLITE_BUSY`. Every write either process makes is a single short
   * transaction (one verb, one webhook row), so 5s is two orders of magnitude
   * above a real write and still well under dokku's 60s request timeout.
   */
  busyTimeoutMs: 5000,
} as const;

/** What ringo appends to its `database/sql` DSN for the same file. */
export const ringoDsnPragmas =
  `_pragma=journal_mode(${writeProtocol.journalMode})` +
  `&_pragma=busy_timeout(${writeProtocol.busyTimeoutMs})`;

/**
 * Every table in `db/schema.ts`, and the only process that may write it. The
 * other process may read every table. Migrations for all of them — ringo's
 * included — live in trailmap's `db/migrate`.
 */
export const tableOwners: Record<string, Owner> = {
  events: "trailmap",
  meta: "trailmap",
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
