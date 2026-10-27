import { RepoController } from "./repo-controller.ts";
import { prNumber, prRefsOf, storiesForRepo } from "../models/concerns/repo-scope.ts";
import { RESOLVED_DEP_STATUSES } from "../models/story.ts";

/** One pull request: its number and the stories stamped with it. */
export interface PullRow {
  ref: string;
  number: number;
  href: string;
  stories: Array<{ id: string; title: string; status: string }>;
  merged: boolean;
}

/**
 * `/:owner/:repo/pulls` — the repo's pull requests, as the task domain records
 * them.
 *
 * trailmap does not talk to GitHub: a PR exists here because a story was
 * stamped with it by `tasks in-progress` or `tasks done` (`stories.pr`, a
 * `repo#N` ref). So this page is the inverse of the issues list — grouped by
 * PR rather than by story — and a PR carries several stories whenever a bundle
 * shipped together, which is the thing GitHub's own list cannot show.
 *
 * "Merged" means every story under the PR is `done` or `closed`. That is the
 * only merge signal in this database; the fleet dashboard gets the real one
 * from ringo's tracker, which RFC 0136 phase B turns into a table.
 */
export class RepoPullsController extends RepoController {
  static tab = "pulls";

  async index(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const byRef = new Map<string, PullRow>();

    for (const ref of prRefsOf(stories)) {
      byRef.set(ref, {
        ref,
        number: prNumber(ref),
        href: `https://github.com/${this.repo.nameWithOwner()}/pull/${prNumber(ref)}`,
        stories: [],
        merged: true,
      });
    }
    for (const story of stories) {
      if (!story.pr) continue;
      const row = byRef.get(story.pr);
      if (!row) continue;
      row.stories.push({ id: story.id, title: story.title ?? story.id, status: story.status });
      if (!(RESOLVED_DEP_STATUSES as readonly string[]).includes(story.status)) {
        row.merged = false;
      }
    }

    const rows = [...byRef.values()];
    const requested = String(this.params.get("state") ?? "open");
    const state = requested === "merged" ? "merged" : "open";
    const shown = rows.filter((row) => (state === "merged" ? row.merged : !row.merged));

    await this.render({
      locals: this.repoLocals({
        state,
        tabCounts: {
          open: rows.filter((row) => !row.merged).length,
          merged: rows.filter((row) => row.merged).length,
        },
        rows: shown,
      }),
    });
  }

  /** `/:owner/:repo/pulls/<number>` — the stories one PR carries. */
  async show(): Promise<void> {
    const number = Number(String(this.params.get("id") ?? ""));
    const ref = `${this.repo.name}#${number}`;
    const stories = (await storiesForRepo(this.repo.name)).filter((story) => story.pr === ref);
    await this.render({
      locals: this.repoLocals({
        ref,
        number,
        href: `https://github.com/${this.repo.nameWithOwner()}/pull/${number}`,
        stories: stories.map((story) => ({
          id: story.id,
          title: story.title ?? story.id,
          status: story.status,
        })),
      }),
      status: stories.length === 0 ? 404 : 200,
    });
  }
}
