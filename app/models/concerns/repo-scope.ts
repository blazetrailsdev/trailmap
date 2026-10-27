import { Event } from "../event.ts";
import { Story } from "../story.ts";
import { StoryPath } from "../joins.ts";

/**
 * Which stories belong to a repository, and the one place that decides it.
 *
 * There is no `repository_id` on `stories`, and this change does not add one:
 * that table lives in the task database, which the tasks CLI also opens, and
 * the hub's ids mean nothing there. What the task domain DOES carry is
 * `stories.pr`, qualified as `repo#N` since the CLI's `qualify_pr_refs`
 * migration — so a story is an issue of the repository its pull request
 * targets. Two rules follow, and they are the whole mapping:
 *
 * - A story whose `pr` is `<name>#N` belongs to `<name>`.
 * - A story with NO pr has not been shipped anywhere yet, so it belongs to the
 *   repository that holds the backlog — the CONTENT repo, `tasks`. Dropping
 *   those would leave the ready queue invisible from every repository page,
 *   and that queue is most of what the backlog is.
 *
 * The consequence to keep in mind: a story moves between repositories when its
 * PR is stamped, and `trails#7228` is a story of `trails` even though its
 * markdown lives in `tasks`. That is the honest answer for data that records a
 * PR and not a repository.
 *
 * SCOPED BY BARE NAME, NOT BY OWNER, and that is a property of the data rather
 * than a shortcut: `stories.pr` is `repo#N` with no owner in it, so `trails#1`
 * names one pull request in this fleet and the column cannot express a second
 * `trails` under a different owner. Two consequences, both deliberate:
 *
 * - `Repository` enforces it. A name is unique across ALL owners, not scoped
 *   to one, so the hub cannot hold the second `trails` that this scope would
 *   mis-attribute. Making the data honest is the only way to keep the scope
 *   honest while the column stays `repo#N`.
 * - Lifting that restriction means qualifying `stories.pr`, which is the tasks
 *   CLI's column and a migration there — not something a page can paper over.
 */
export const CONTENT_REPO = "tasks";

/**
 * One scoped story, as the repo tabs read it.
 *
 * PLUCKED, not loaded. `trails` has 9,178 scoped stories and `tasks` 2,162,
 * and building that many `Story` objects to read seven fields of each is the
 * whole second a page takes — the same reason `/rfcs` and `/backlog` pluck.
 * These seven are every field the issue rows, the PR grouping and the tab
 * counts need, so nothing has to go back for records afterwards.
 */
export interface ScopedStory {
  id: string;
  rfc_id: string;
  status: string;
  pr: string | null;
  title: string | null;
  assignee: string | null;
  priority: number | null;
  est_loc: number | null;
}

const COLUMNS = ["id", "rfc_id", "status", "pr", "title", "assignee", "priority", "est_loc"] as const;

/**
 * `my_repo` is a legal repository name and `_` is a LIKE WILDCARD, so an
 * unescaped pattern matches `myXrepo#1` as readily as `my_repo#1`. Rails
 * escapes for exactly this (`sanitize_sql_like`, sanitization.rb:132) using
 * the same backslash convention, which SQLite accepts via `ESCAPE`.
 *
 * `%` is escaped too even though `Repository` does not permit it today: the
 * validation is the only thing keeping it out, and a scope that silently
 * depends on a validation elsewhere is one edit from being wrong.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * The relations the scope rule selects: one on `pr LIKE 'repo#%'`, plus the
 * unattributed stories when `repo` is the content repo.
 *
 * ONE definition of the rule, used by the list and the single-story lookup
 * alike. Each needs a different projection — eight columns, one row — and
 * before this they each re-derived the predicate, which is how `storyForRepo`
 * ended up scanning the whole list to find one id. `openCountsByRepo` is the
 * same rule as a grouping key, and the tests hold the two together.
 */
function scopeRelations(repo: string) {
  const relations = [Story.where("pr LIKE ? ESCAPE '\\'", `${escapeLike(repo)}#%`)];
  if (repo === CONTENT_REPO) relations.push(Story.where({ pr: null }));
  return relations;
}

/** Every story scoped to `repo`, by the rule above. */
export async function storiesForRepo(repo: string): Promise<ScopedStory[]> {
  const scoped: ScopedStory[] = [];
  for (const relation of scopeRelations(repo)) scoped.push(...(await pluckScoped(relation)));
  return scoped;
}

/**
 * How many of each repository's stories are still open, in ONE query.
 *
 * The owner page wants one integer per repository. Grouped rather than a
 * count per repository, so the page costs the same at four repositories and
 * at four hundred. The grouping key IS the scope rule above, in SQL: the name
 * in front of `pr`'s `#` — lower-cased, because `scopeRelations`' LIKE is
 * case-insensitive in SQLite, so `Trails#5` is a story of `trails` there and
 * must be one here. A story with no `pr` groups under NULL, which is the
 * content repo's; a `pr` with no `#` groups under '' and is nobody's, as no
 * `LIKE 'repo#%'` matches it either.
 *
 * Every name in `repos` gets an entry — a repository with no open stories
 * reads 0. "Open" is everything that is not `done` or `closed`, the same two
 * terminal statuses the issue tabs use.
 */
export async function openCountsByRepo(repos: string[]): Promise<Map<string, number>> {
  const counted = (await Story.where("status NOT IN (?, ?)", "done", "closed")
    .group("lower(substr(pr, 1, instr(pr, '#') - 1))")
    .count()) as Map<string | null, number>;
  const open = (repo: string): number =>
    (counted.get(repo.toLowerCase()) ?? 0) + (repo === CONTENT_REPO ? (counted.get(null) ?? 0) : 0);
  return new Map(repos.map((repo) => [repo, open(repo)]));
}

async function pluckScoped(relation: {
  pluck(...columns: string[]): Promise<unknown[]>;
}): Promise<ScopedStory[]> {
  const rows = await relation.pluck(...COLUMNS);
  const out: ScopedStory[] = [];
  for (const row of rows) {
    // A non-row is a framework fault, and it is raised rather than skipped: a
    // dropped row here is a story missing from a repo's issue list with
    // nothing to say why. `Story.rankingIndex` makes the same call.
    if (!Array.isArray(row)) throw new TypeError(`pluck returned a non-row: ${String(row)}`);
    const [id, rfcId, status, pr, title, assignee, priority, estLoc] = row;
    out.push({
      id: String(id),
      rfc_id: String(rfcId),
      status: String(status),
      pr: pr == null ? null : String(pr),
      title: title == null ? null : String(title),
      assignee: assignee == null ? null : String(assignee),
      priority: typeof priority === "number" ? priority : null,
      est_loc: typeof estLoc === "number" ? estLoc : null,
    });
  }
  return out;
}

/**
 * One story, IF it belongs to this repository.
 *
 * The scope rule lives here and nowhere else (CLAUDE.md), so a page that wants
 * a single story asks for it the same way a page that wants a list does. A
 * bare `Story.findBy({ id })` in a controller would serve `tasks`' stories
 * under `/blazetrailsdev/trails/issues/<id>` and vice versa.
 *
 * Scoped AND keyed in the query, not filtered out of the full list: an issue
 * page is one row, and reading nine thousand to find it was the cost of
 * sharing a helper rather than sharing the predicate.
 */
export async function storyForRepo(repo: string, id: string): Promise<ScopedStory | null> {
  if (id === "") return null;
  for (const relation of scopeRelations(repo)) {
    const found = await pluckScoped(relation.where({ id }));
    if (found[0]) return found[0];
  }
  return null;
}

/** The `pr` values (`repo#N`) seen on these stories, highest number first. */
export function prRefsOf(stories: ScopedStory[]): string[] {
  const refs = new Set<string>();
  for (const story of stories) if (story.pr) refs.add(story.pr);
  return [...refs].sort((a, b) => prNumber(b) - prNumber(a));
}

/** `trails#7228` → 7228, and 0 for anything that is not one. */
export function prNumber(ref: string): number {
  const at = ref.indexOf("#");
  const parsed = at < 0 ? NaN : Number(ref.slice(at + 1));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** One event, as the Actions and Insights tabs read it. Plucked, not loaded. */
export interface ScopedEvent {
  at: string;
  verb: string;
  story_id: string | null;
  pr: string | null;
  actor: string | null;
}

/**
 * How many ids go into one `column IN (…)`.
 *
 * `trails` scopes to over nine thousand stories, so building that `IN` from
 * the whole scope is a query with nine thousand binds. MEASURED, because the
 * first version of this comment guessed: this build of SQLite accepts 32,766
 * bound parameters and refuses 32,767 with "too many SQL variables". So
 * nine thousand does not fail today — it is one more `trails`-sized repository
 * away from failing, and it is a query shape no index helps in the meantime.
 *
 * 900 is therefore a guard against growth and a better plan, not a fix for a
 * present error. It is kept because the alternative was two policies for one
 * constraint: `eventsForRepo` below went out of its way to avoid binding the
 * scope's ids while the code tab bound all of them.
 */
const BIND_CHUNK = 900;

/** `ids` in chunks small enough to be bound, preserving order. */
export function inChunks<T>(ids: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += BIND_CHUNK) chunks.push(ids.slice(i, i + BIND_CHUNK));
  return chunks;
}

/**
 * Every `story_paths.path` the scope's stories cite, chunked as above.
 *
 * Order is not promised: the caller counts paths by their first segment.
 */
export async function pathsForStories(stories: ScopedStory[]): Promise<string[]> {
  const ids = stories.map((story) => story.id);
  const paths: string[] = [];
  for (const chunk of inChunks(ids)) {
    for (const row of await StoryPath.where({ story_id: chunk }).pluck("path")) {
      paths.push(Array.isArray(row) ? String(row[0]) : String(row));
    }
  }
  return paths;
}

/**
 * The repo's events inside a time window, newest first.
 *
 * Bounded by TIME rather than by the scope's story ids: the window is indexed
 * (`index_events_on_at`), so this reads the recent slice and filters it to the
 * scope in memory, instead of binding nine thousand ids (see BIND_CHUNK). A
 * list that needs the ids themselves chunks — `pathsForStories` above.
 *
 * What that costs: activity older than the window is invisible to the tabs
 * that use this, which is why both of them SAY their window on the page.
 */
export async function eventsForRepo(
  stories: ScopedStory[],
  windowDays: number,
  limit: number,
): Promise<ScopedEvent[]> {
  if (stories.length === 0) return [];
  const mine = new Set(stories.map((story) => story.id));
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  // `events.at` is a string column holding an ISO instant, so this is a string
  // comparison — sound for ISO-8601 in UTC, and how `read_models#events`
  // reads it too.
  const rows = await Event.where("at >= ?", since)
    .order("at DESC")
    .pluck("at", "verb", "story_id", "pr", "actor");
  const out: ScopedEvent[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) throw new TypeError(`pluck returned a non-row: ${String(row)}`);
    const [at, verb, storyId, pr, actor] = row;
    if (storyId == null || !mine.has(String(storyId))) continue;
    out.push({
      at: String(at),
      verb: String(verb),
      story_id: String(storyId),
      pr: pr == null ? null : String(pr),
      actor: actor == null ? null : String(actor),
    });
    if (out.length === limit) break;
  }
  return out;
}
