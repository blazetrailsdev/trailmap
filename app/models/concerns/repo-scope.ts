import { Event } from "../event.js";
import { Story } from "../story.js";

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

/** Every story scoped to `repo`, by the rule above. */
export async function storiesForRepo(repo: string): Promise<ScopedStory[]> {
  const scoped = [...(await pluckScoped(Story.where("pr LIKE ?", `${repo}#%`)))];
  if (repo === CONTENT_REPO) scoped.push(...(await pluckScoped(Story.where({ pr: null }))));
  return scoped;
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
 * The repo's events inside a time window, newest first.
 *
 * Bounded by TIME rather than by the scope's story ids, deliberately: the
 * scope is nine thousand ids on `trails`, and `WHERE story_id IN (…)` with
 * nine thousand binds is a query no index helps and that SQLite's parameter
 * limit eventually refuses outright. The window is indexed
 * (`index_events_on_at`), so this reads the recent slice and filters it to the
 * scope in memory.
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
