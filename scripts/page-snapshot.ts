/**
 * The golden snapshot of ringo's show pages: its format, and both sides of it.
 *
 * `scripts/page-equivalence.ts` diffs trailmap's `/rfc/<id>` and `/story/<id>`
 * against ringo's over the whole database. It cannot run in CI — ringo serves
 * from a checkout and a database that exist only on the box — and it has a
 * quieter failure mode than that: `land-the-ringo-read-model-deletion` moves
 * ringo's `loadIndex` onto trailmap's own API, after which ringo's
 * `HandleRFCPage` and `HandleStoryPage` render from data trailmap produced.
 * The gate would keep running and keep reporting EQUIVALENT while comparing
 * trailmap against itself. It goes circular, not red — and a green check that
 * proves nothing is indistinguishable from one that proves something.
 *
 * So ringo's answers are captured here while ringo still has its own read
 * model, and replayed in CI by `scripts/gate-page-snapshot.ts` with no ringo
 * present. What is captured is the extracted FACTS, not the HTML: the markup
 * is deliberately different on the two sides and was never what the gate
 * compared.
 *
 * The format is one JSON object per line, sorted by kind and then by id, so a
 * re-record produces a diff that reads page by page. Records carry no
 * timestamp for the same reason.
 */
import type { RfcPageFacts, StoryPageFacts } from "./page-extract.js";

/** Where the recorded facts live, relative to the repository root. */
export const SNAPSHOT_FILE = "test/fixtures/ringo-show-pages.ndjson";

/**
 * Where the rows those facts were rendered from live.
 *
 * The recording is of ringo's answers over the database as it stood at that
 * moment, and this database never stands still — it is under continuous agent
 * traffic, and a story changed `claimed` to `in-progress` between the record
 * and the first replay. Replaying the facts against anything else diffs the
 * database's movement, not trailmap's rendering.
 *
 * Ingesting the tasks content tree does not close that gap either, which was
 * worth measuring rather than assuming: a tree ingested at the recording's own
 * commit reproduced all 8,806 story pages and 47 RFC-page facts wrong, because
 * `status`, `assignee` and `pr` are database-owned and reach git only when
 * `tasks export` runs, and because a first ingest closes an RFC whose stories
 * are all done while an incremental one never did.
 *
 * So the rows travel with the facts. What CI then proves is the thing the four
 * defects were all about — how trailmap ORDERS, RANKS and LABELS a fixed set
 * of rows — with the database's own movement held still.
 */
export const ROWS_FILE = "test/fixtures/ringo-show-pages-rows.ndjson";

/** The tables the show pages read, in insert order (parents first). */
export const SNAPSHOT_TABLES = ["rfcs", "stories", "story_deps", "story_rfc_deps"] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/** One database row, as recorded. */
export interface RowRecord {
  table: SnapshotTable;
  row: Record<string, unknown>;
}

/**
 * The rows fixture's text.
 *
 * Rows keep the order the recording read them in, which is each table's rowid
 * — the order they were inserted in. That is not decoration: `story_deps` has
 * no ordering column, so a story's dependency list is its insertion order, and
 * "deps returned alphabetically" was one of the four defects the live gate
 * found. Re-ordering the fixture would have rebuilt that defect inside it.
 */
export function encodeRows(rows: readonly RowRecord[]): string {
  return `${rows.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

/**
 * The rows in a fixture's text, in file order.
 *
 * Table and column names out of this file are interpolated into INSERT
 * statements by the replay — they cannot be bound as parameters — so they are
 * checked here rather than trusted. The fixture is committed and machine-
 * written, which makes a bad name a corrupted or hand-edited file; failing on
 * the name beats letting it reach the database as SQL.
 */
export function decodeRows(text: string): RowRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, at) => {
      const record = JSON.parse(line) as RowRecord;
      if (!SNAPSHOT_TABLES.includes(record.table)) {
        throw new Error(`${ROWS_FILE}:${at + 1}: unknown table ${JSON.stringify(record.table)}`);
      }
      for (const column of Object.keys(record.row)) {
        if (!COLUMN_NAME.test(column)) {
          throw new Error(`${ROWS_FILE}:${at + 1}: unusable column name ${JSON.stringify(column)}`);
        }
      }
      return record;
    });
}

/** A column name this schema can actually have, and that is safe to quote. */
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** An RFC page, as ringo stated it. */
export interface RfcRecord extends RfcPageFacts {
  kind: "rfc";
  id: string;
}

/**
 * A story page, as ringo stated it — or the note that ringo had no page to
 * state it on.
 *
 * ringo's story show page is served through `allStories`
 * (`webhook/spawnloop.go:1384`), the BACKLOG's query, which drops every story
 * under a closed RFC. A permalink to one of those answers "no story found"
 * there and renders here: a divergence trailmap chose. Recording `exempt`
 * keeps that distinction in the fixture, where recording a match would erase
 * it — the replay must assert trailmap still SERVES those pages while having
 * nothing of ringo's to compare them against.
 */
export type StoryRecord =
  | ({ kind: "story"; id: string; exempt?: false } & StoryPageFacts)
  | { kind: "story"; id: string; exempt: true };

export type PageRecord = RfcRecord | StoryRecord;

/** Whether a story record is one ringo had no page for. */
export function isExempt(record: StoryRecord): record is { kind: "story"; id: string; exempt: true } {
  return record.exempt === true;
}

/**
 * The fixture's text, from records in any order.
 *
 * Keys are written in a fixed order rather than whatever order the extractor
 * built the object in, so two recordings of the same page are the same bytes.
 */
export function encodeSnapshot(records: readonly PageRecord[]): string {
  const sorted = [...records].sort((a, b) =>
    a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1,
  );
  return `${sorted.map((record) => JSON.stringify(ordered(record))).join("\n")}\n`;
}

/** The records in a fixture's text, in file order. */
export function decodeSnapshot(text: string): PageRecord[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as PageRecord);
}

/**
 * The facts half of a record, which is what the replay diffs.
 *
 * `kind`, `id` and `exempt` address the record; everything else is what the
 * page said. Dropping exactly those three is what lets `diffFacts` compare a
 * recording against a freshly extracted page without either side carrying a
 * field the other cannot have.
 */
export function factsOf(record: RfcRecord): RfcPageFacts;
export function factsOf(record: StoryRecord & { exempt?: false }): StoryPageFacts;
export function factsOf(record: PageRecord): RfcPageFacts | StoryPageFacts {
  const source = record as unknown as Record<string, unknown>;
  const facts: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!ADDRESSING_KEYS.includes(key)) facts[key] = source[key];
  }
  return facts as unknown as RfcPageFacts | StoryPageFacts;
}

/** The keys that address a record rather than state what its page said. */
const ADDRESSING_KEYS = ["kind", "id", "exempt"];

const RFC_KEYS = ["kind", "id", "title", "status", "done", "total", "stories", "storyStatuses"];
const STORY_KEYS = ["kind", "id", "exempt", "title", "status", "rfc", "deps", "rfcDeps"];

function ordered(record: PageRecord): Record<string, unknown> {
  const source = record as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of record.kind === "rfc" ? RFC_KEYS : STORY_KEYS) {
    if (key in source) out[key] = source[key];
  }
  return out;
}
