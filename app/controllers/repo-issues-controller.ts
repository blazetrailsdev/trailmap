import { RepoController } from "./repo-controller.js";
import { RESOLVED_DEP_STATUSES } from "../models/story.js";
import {
  storiesForRepo,
  storyForRepo,
  type ScopedStory,
} from "../models/concerns/repo-scope.js";
import { pagerFor, requestedPage } from "../models/concerns/pager.js";

/** A page of issues, the size `/backlog` uses. */
export const ISSUES_PAGE_SIZE = 100;

/** One row of the issues list. A `.tse` cannot compute, so this is built here. */
export interface IssueRow {
  id: string;
  title: string;
  status: string;
  rfcId: string;
  pr: string | null;
  assignee: string | null;
  estLoc: number | null;
  priority: number | null;
}

/**
 * `/:owner/:repo/issues` — the repo's stories.
 *
 * A story IS this domain's issue: a unit of work with a status, an owner and a
 * body someone wrote. Which repository it belongs to is decided by
 * `storiesForRepo`, and that rule is worth reading before this page confuses
 * you — there is no repository column on `stories`.
 *
 * Open and Closed, as GitHub counts them: `done` and `closed` are closed (the
 * same pair `RESOLVED_DEP_STATUSES` calls resolved — a closed story will never
 * ship but will also never block), everything else is open.
 *
 * Ordered and counted WHOLE, then cut to a page, exactly as `/backlog` does:
 * a tab's count is a fact about the tab and not about the page you are on.
 * `trails` has 9,163 closed stories, and the first draft of this page drew all
 * of them — seven megabytes of HTML.
 */
export class RepoIssuesController extends RepoController {
  static tab = "issues";

  async index(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const open = stories.filter((story) => !isClosed(story));
    const closed = stories.filter((story) => isClosed(story));

    const requested = String(this.params.get("state") ?? "open");
    const state = requested === "closed" ? "closed" : "open";
    const shown = (state === "closed" ? closed : open).sort(byPriorityThenId);

    const pager = pagerFor(
      shown.length,
      ISSUES_PAGE_SIZE,
      requestedPage(this.params.get("page")),
      (page) => `/${this.repo.nameWithOwner()}/issues?state=${state}&page=${page}`,
    );

    await this.render({
      locals: this.repoLocals({
        state,
        pager,
        tabCounts: { open: open.length, closed: closed.length },
        rows: shown
          .slice(pager.from === 0 ? 0 : pager.from - 1, pager.to)
          .map(toRow),
      }),
    });
  }

  /**
   * `/:owner/:repo/issues/<story-id>`.
   *
   * SCOPED. An unscoped `Story.findBy({ id })` renders `tasks`' stories under
   * `/blazetrailsdev/trails/issues/…` — a repository serving another's work,
   * from a URL that says otherwise. The scope rule has one home
   * (`repo-scope.ts`); this asks it rather than re-deriving it.
   */
  async show(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const story = await storyForRepo(this.repo.name, id);

    await this.render({
      locals: this.repoLocals({ id, row: story === null ? null : toRow(story) }),
      status: story === null ? 404 : 200,
    });
  }
}

function isClosed(story: ScopedStory): boolean {
  return (RESOLVED_DEP_STATUSES as readonly string[]).includes(story.status);
}

/** Effective priority first, then id — the backlog's own tie-break. */
function byPriorityThenId(a: ScopedStory, b: ScopedStory): number {
  return (a.priority ?? 1_000_000) - (b.priority ?? 1_000_000) || a.id.localeCompare(b.id);
}

function toRow(story: ScopedStory): IssueRow {
  return {
    id: story.id,
    title: story.title ?? story.id,
    status: story.status,
    rfcId: story.rfc_id,
    pr: story.pr,
    assignee: story.assignee,
    estLoc: story.est_loc,
    priority: story.priority,
  };
}
