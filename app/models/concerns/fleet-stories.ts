/**
 * The tasks database's half of the dashboard's sessions (RFC 0232): which
 * stories a PR closes, the stage an agent reported for its story, and the
 * stories the ⌘K palette finds.
 *
 * Every story of every status, so a merged session still lists its now-done
 * stories. One shape for all three reads, so the page has one decoder.
 */
import { Story } from "../story.ts";

/** The most refs one `fleet/stories` request may name. */
export const FLEET_STORIES_MAX_REFS = 100;

/** The most stories the palette's search answers. */
export const FLEET_STORIES_MAX_HITS = 20;

export interface FleetStory {
  id: string;
  title: string;
  status: string;
  rfc: string;
  stage: string | null;
}

type Row = [string, string | null, string, string, string | null];

const COLUMNS = ["id", "title", "status", "rfc_id", "stage"] as const;

const toStory = ([id, title, status, rfc, stage]: Row): FleetStory => ({
  id,
  title: title ?? id,
  status,
  rfc,
  stage: stage ?? null,
});

/** `repo#N` refs to their stories, by id; an empty list for a ref nothing names. */
export async function storiesForPrs(refs: string[]): Promise<Record<string, FleetStory[]>> {
  const answer: Record<string, FleetStory[]> = {};
  for (const ref of refs) answer[ref] = [];
  if (refs.length === 0) return answer;
  const rows = (await Story.where({ pr: refs }).order("id").pluck(...COLUMNS, "pr")) as [...Row, string][];
  for (const row of rows) answer[row[5]]?.push(toStory(row.slice(0, 5) as Row));
  return answer;
}

/** Story ids to themselves, for a spawn that has no PR yet; null for an id nothing names. */
export async function storiesForIds(ids: string[]): Promise<Record<string, FleetStory | null>> {
  const answer: Record<string, FleetStory | null> = {};
  for (const id of ids) answer[id] = null;
  if (ids.length === 0) return answer;
  for (const row of (await Story.where({ id: ids }).pluck(...COLUMNS)) as Row[]) answer[row[0]] = toStory(row);
  return answer;
}

/**
 * Stories whose id or title contains `phrase`, ASCII-case-insensitively, at
 * most `FLEET_STORIES_MAX_HITS`: an id match first, then a title that starts
 * with it, then the rest, each by id.
 */
export async function storiesMatching(phrase: string): Promise<FleetStory[]> {
  const needle = phrase.toLowerCase();
  const pattern = `%${Story.sanitizeSqlLike(needle)}%`;
  const table = Story.arelTable;
  const condition = table.get("title").lower().matches(pattern, "\\").or(table.get("id").lower().matches(pattern, "\\"));
  const rows = (await Story.where(condition).order("id").pluck(...COLUMNS)) as Row[];
  const tier = ([id, title]: Row): number => {
    if (id.toLowerCase().includes(needle)) return 0;
    return (title ?? "").toLowerCase().startsWith(needle) ? 1 : 2;
  };
  return rows
    .map((row, at) => ({ row, at, tier: tier(row) }))
    .sort((a, b) => a.tier - b.tier || a.at - b.at)
    .slice(0, FLEET_STORIES_MAX_HITS)
    .map(({ row }) => toStory(row));
}

export const FleetStories = { storiesForPrs, storiesForIds, storiesMatching };
