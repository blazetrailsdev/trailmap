import { RepoController } from "./repo-controller.ts";
import { eventsForRepo, storiesForRepo } from "../models/concerns/repo-scope.ts";
import { STORY_STATUSES } from "../models/story.ts";

/** How far back the activity figures look. GitHub's Pulse offers a month. */
const WINDOW_DAYS = 30;

/** Count every event in the window, not the first page of them. */
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * `/:owner/:repo/pulse` — the Insights tab.
 *
 * Two questions, both answerable from rows this database already has: what
 * state is the repo's work in (stories by status, and the estimate still
 * outstanding), and what has moved lately (events in the last 30 days, by
 * verb, with the done count called out).
 *
 * Deliberately NOT the velocity chart. That one belongs to
 * `point-velocity-at-the-events-table`, reads the same table, and will land
 * here when it does — adding a second, differently-computed version of it
 * would make the two disagree, which is the whole defect RFC 0136 is about.
 */
export class RepoInsightsController extends RepoController {
  static tab = "insights";

  async show(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    // `eventsForRepo` applies the window itself, and `NO_LIMIT` is larger
    // than any 30-day slice of this table — the figures below are counts, so
    // a truncated slice would quietly understate them.
    const recent = await eventsForRepo(stories, WINDOW_DAYS, NO_LIMIT);
    const byVerb = new Map<string, number>();
    for (const event of recent) byVerb.set(event.verb, (byVerb.get(event.verb) ?? 0) + 1);

    const byStatus = new Map<string, number>();
    for (const story of stories) {
      byStatus.set(story.status, (byStatus.get(story.status) ?? 0) + 1);
    }

    const openEstimate = stories
      .filter((story) => story.status !== "done" && story.status !== "closed")
      .reduce((total, story) => total + (story.est_loc ?? 0), 0);

    await this.render({
      locals: this.repoLocals({
        windowDays: WINDOW_DAYS,
        storyCount: stories.length,
        openEstimate,
        statuses: STORY_STATUSES.map((status) => ({
          status,
          count: byStatus.get(status) ?? 0,
        })).filter((row) => row.count > 0),
        verbs: [...byVerb.entries()]
          .map(([verb, count]) => ({ verb, count }))
          .sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb)),
        recentCount: recent.length,
        doneCount: recent.filter((event) => event.verb === "done").length,
      }),
    });
  }
}
