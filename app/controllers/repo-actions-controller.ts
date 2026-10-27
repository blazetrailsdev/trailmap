import { RepoController } from "./repo-controller.ts";
import { eventsForRepo, storiesForRepo } from "../models/concerns/repo-scope.ts";

/** How many events the tab shows. A run log is read from the top. */
const RUN_LIMIT = 100;

/**
 * How far back it looks. `eventsForRepo` is bounded by time rather than by the
 * scope's story ids — nine thousand of them on `trails` — so the window is
 * part of what the page states.
 */
const WINDOW_DAYS = 90;

/**
 * `/:owner/:repo/actions` — what has happened to this repo's work, newest
 * first.
 *
 * GitHub's Actions tab is a run log, and this is the run log this domain has:
 * the `events` table, one row per mutation verb, which RFC 0136 added so the
 * event stream stops being a parse of the tasks git log. Each row is an actor,
 * a verb, a story and a time.
 *
 * Deploys and CI runs are NOT here yet, and that is the honest state: both are
 * ringo's JSON files (`deploys.json`, `main-ci-failures.json`) until phase B
 * gives them tables in this database. When it does, they belong on this page.
 */
export class RepoActionsController extends RepoController {
  static tab = "actions";

  async index(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const events = await eventsForRepo(stories, WINDOW_DAYS, RUN_LIMIT);
    const titles = new Map(stories.map((story) => [story.id, story.title ?? story.id]));

    await this.render({
      locals: this.repoLocals({
        limit: RUN_LIMIT,
        windowDays: WINDOW_DAYS,
        rows: events.map((event) => ({
          at: event.at,
          verb: event.verb,
          storyId: event.story_id,
          storyTitle: event.story_id === null ? null : (titles.get(event.story_id) ?? null),
          pr: event.pr,
          actor: event.actor,
        })),
      }),
    });
  }
}
