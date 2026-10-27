/**
 * `/search` — stories and RFCs whose id, title or body mention a phrase.
 *
 * Ids and titles are columns, so they are matched where they live: an Arel
 * `matches` (a `LIKE` with its wildcards escaped) built through the model,
 * never a string of SQL. Bodies are NOT columns — `ingest` stores the
 * metadata and leaves the markdown on disk (`concerns/document.ts`) — so they
 * are matched against a copy read once per ingest: `bodyIndex()` keys it on
 * `meta.last_ingested_sha`, which is exactly when the files can have changed.
 *
 * Ranked by where the phrase was found:
 *
 *   0  the id is the phrase
 *   1  the title starts with it
 *   2  the id or title contains it
 *   3  only the body does
 *
 * Within a tier, more body mentions first, then RFC before story, then by id,
 * so a page's order is stable and the pager's pages are the whole list.
 */
import { Meta } from "../meta.ts";
import { Rfc } from "../rfc.ts";
import { Story } from "../story.ts";
import { readDocument } from "./document.ts";

/** Shorter matches nearly every document and ranks nothing; longer is a paste. */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

export type SearchKind = "rfc" | "story";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  status: string;
  /** The RFC a story belongs to; null for an RFC. */
  rfcId: string | null;
  tier: number;
  /** Mentions in the body; 0 when the body was not read or says nothing. */
  mentions: number;
  /** Relative to the tasks checkout; what `withSnippets` reads. */
  filePath: string | null;
  /** A stretch of the body around the first mention, or "" for none. Filled by `withSnippets`. */
  snippet: string;
}

/** The phrase a request means, trimmed and bounded; null when there is none to search. */
export function searchPhrase(param: unknown): string | null {
  if (typeof param !== "string") return null;
  // Cut, THEN trim: a cut that lands after a space would otherwise make the
  // space part of the needle.
  const phrase = param
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, SEARCH_MAX_LENGTH)
    .trim();
  return phrase.length < SEARCH_MIN_LENGTH ? null : phrase;
}

interface Row {
  kind: SearchKind;
  id: string;
  title: string | null;
  status: string;
  rfcId: string | null;
  filePath: string | null;
}

/** Every hit for `phrase`, ranked. The caller pages it. */
export async function search(phrase: string): Promise<SearchHit[]> {
  const needle = phrase.toLowerCase();
  const [rows, titled, bodies] = await Promise.all([
    allRows(),
    titleMatches(phrase),
    bodyIndex(),
  ]);

  const hits: SearchHit[] = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    const body = bodies.get(key);
    const mentions = body ? countMentions(body, needle) : 0;
    let tier: number;
    if (row.id.toLowerCase() === needle) tier = 0;
    else if (
      (row.title ?? "").toLowerCase().startsWith(needle) &&
      titled.has(key)
    )
      tier = 1;
    else if (titled.has(key)) tier = 2;
    else if (mentions > 0) tier = 3;
    else continue;
    hits.push({
      kind: row.kind,
      id: row.id,
      title: row.title ?? row.id,
      status: row.status,
      rfcId: row.rfcId,
      tier,
      mentions,
      filePath: row.filePath,
      snippet: "",
    });
  }
  return hits.sort(compareHits);
}

/**
 * `hits` with their snippets, read from the files. Only the page being shown
 * is passed, so this is fifty reads, not fourteen thousand — the index keeps
 * bodies lowercased only, and a snippet should read as written.
 */
export async function withSnippets(
  hits: SearchHit[],
  phrase: string,
): Promise<SearchHit[]> {
  const needle = phrase.toLowerCase();
  return Promise.all(
    hits.map(async (hit) =>
      hit.mentions === 0
        ? hit
        : {
            ...hit,
            snippet: snippetOf(
              (await readDocument(hit.filePath)).markdown,
              needle,
            ),
          },
    ),
  );
}

export function compareHits(a: SearchHit, b: SearchHit): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.mentions !== b.mentions) return b.mentions - a.mentions;
  if (a.kind !== b.kind) return a.kind === "rfc" ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * `kind:id` of every story and RFC whose id or title contains the phrase,
 * ASCII-case-insensitively: SQLite's `lower()` folds ASCII only, so `É` in a
 * title matches only `É`. The tiers above use JS case folding for the prefix
 * test but only among these rows, so a fold SQLite missed costs the hit its
 * title tier, never a wrong one.
 * case-insensitively. `sanitizeSqlLike` escapes the phrase's own `%` and `_`,
 * so `est_loc` means those seven characters and not a pattern.
 */
async function titleMatches(phrase: string): Promise<Set<string>> {
  const pattern = `%${Story.sanitizeSqlLike(phrase.toLowerCase())}%`;
  const matched = new Set<string>();
  for (const model of [Story, Rfc] as const) {
    const table = model.arelTable;
    const condition = table
      .get("title")
      .lower()
      .matches(pattern, "\\")
      .or(table.get("id").lower().matches(pattern, "\\"));
    const ids = (await model.where(condition).pluck("id")) as string[];
    const kind: SearchKind = model === Story ? "story" : "rfc";
    for (const id of ids) matched.add(`${kind}:${id}`);
  }
  return matched;
}

async function allRows(): Promise<Row[]> {
  const [stories, rfcs] = await Promise.all([
    Story.pluck("id", "title", "status", "rfc_id", "file_path") as Promise<
      [string, string | null, string, string, string | null][]
    >,
    Rfc.pluck("id", "title", "status", "file_path") as Promise<
      [string, string | null, string, string | null][]
    >,
  ]);
  return [
    ...rfcs.map(([id, title, status, filePath]) => ({
      kind: "rfc" as const,
      id,
      title,
      status,
      rfcId: null,
      filePath,
    })),
    ...stories.map(([id, title, status, rfcId, filePath]) => ({
      kind: "story" as const,
      id,
      title,
      status,
      rfcId,
      filePath,
    })),
  ];
}

/** How many reads are in flight while the index is built: enough to keep the disk busy, not the descriptor table full. */
const READ_CONCURRENCY = 64;

let cached: {
  sha: string | null;
  bodies: Promise<Map<string, string>>;
} | null = null;

/**
 * Every body, lowercased, keyed `kind:id` — read once per ingest. The first
 * search after an ingest pays for the read (under a second for ~14,000 files
 * on the box); every other one reads memory. Concurrent first searches share
 * one read.
 */
export async function bodyIndex(): Promise<Map<string, string>> {
  const sha = await Meta.get("last_ingested_sha");
  if (cached === null || cached.sha !== sha) {
    const bodies = readBodies();
    cached = { sha, bodies };
    // A failed read is not cached: the next search tries again.
    bodies.catch(() => {
      if (cached?.bodies === bodies) cached = null;
    });
  }
  return cached.bodies;
}

/** Drop the cached bodies. For tests, which change the files under one sha. */
export function resetBodyIndex(): void {
  cached = null;
}

async function readBodies(): Promise<Map<string, string>> {
  const rows = (await allRows()).filter((row) => row.filePath);
  const bodies = new Map<string, string>();
  for (let at = 0; at < rows.length; at += READ_CONCURRENCY) {
    const batch = rows.slice(at, at + READ_CONCURRENCY);
    const read = await Promise.all(
      batch.map((row) => readDocument(row.filePath)),
    );
    batch.forEach((row, i) =>
      bodies.set(`${row.kind}:${row.id}`, read[i]!.markdown.toLowerCase()),
    );
  }
  return bodies;
}

function countMentions(body: string, needle: string): number {
  let count = 0;
  for (
    let at = body.indexOf(needle);
    at !== -1;
    at = body.indexOf(needle, at + needle.length)
  ) {
    count++;
  }
  return count;
}

/** Characters either side of the first mention. */
const SNIPPET_CONTEXT = 80;

function snippetOf(text: string, needle: string): string {
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return "";
  const start = Math.max(0, at - SNIPPET_CONTEXT);
  const end = Math.min(text.length, at + needle.length + SNIPPET_CONTEXT);
  const shown = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${shown}${end < text.length ? "…" : ""}`;
}
