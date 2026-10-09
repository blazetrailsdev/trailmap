import { RepoController } from "./repo-controller.js";
import { StoryPath } from "../models/joins.js";
import { storiesForRepo } from "../models/concerns/repo-scope.js";

/**
 * `/:owner/:repo` — the code tab, which IS the repository page, as it is on
 * GitHub.
 *
 * It shows what trailmap actually knows about a repository: the record itself
 * (its checkout on this box, its default branch, its visibility) and the
 * directories the task domain says the work touches, counted from the
 * `story_paths` rows of the repo's stories. That last part is the closest
 * thing to a file tree there is here — trailmap does not read the checkout —
 * and it answers a question a file tree cannot: where the open work is.
 */
export class RepoCodeController extends RepoController {
  static tab = "code";

  async show(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const paths = await StoryPath.where({ story_id: stories.map((story) => story.id) }).pluck(
      "path",
    );

    // Grouped by first segment: `packages/activerecord/src/base.ts` counts
    // towards `packages`. A full tree of 22,000 cited paths is not a page.
    const counts = new Map<string, number>();
    for (const row of paths) {
      const value = Array.isArray(row) ? String(row[0]) : String(row);
      const top = value.split("/")[0] ?? value;
      if (top === "") continue;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }

    await this.render({
      locals: this.repoLocals({
        storyCount: stories.length,
        directories: [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      }),
    });
  }
}
