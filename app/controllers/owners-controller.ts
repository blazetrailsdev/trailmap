import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.js";
import { Owner } from "../models/owner.js";
import { Repository } from "../models/repository.js";
import { storiesForRepo } from "../models/concerns/repo-scope.js";

/**
 * `/:owner` — the owner root, as GitHub's account page is: who this is, and
 * the repositories under it.
 *
 * The one page above the repo hierarchy, and the reason `:owner` is a
 * single-segment route drawn last in `config/routes.ts` — read
 * `RESERVED_OWNER_NAMES` there before adding a top-level page.
 *
 * Each row carries its repo's open-story count, which is the only number worth
 * putting next to a repository name here: it is what tells you where the work
 * is. It costs one scoped query per repository, which is fine at four
 * repositories and would not be at four hundred — the day that matters, the
 * count belongs in one grouped query, not a loop.
 */
export class OwnersController extends ApplicationController {
  async show(): Promise<void> {
    const login = String(this.params.get("owner") ?? "");
    const owner = login === "" ? null : await Owner.findByLogin(login);
    if (owner === null) throw new RecordNotFound(`No owner ${login}`);

    const repos = await Repository.where({ owner_id: owner.id }).order("name").toArray();
    const rows = [];
    for (const repo of repos) {
      const stories = await storiesForRepo(repo.name);
      rows.push({
        name: repo.name,
        href: `/${owner.login}/${repo.name}`,
        description: repo.description,
        visibility: repo.visibility,
        defaultBranch: repo.default_branch,
        archived: repo.archived,
        openCount: stories.filter(
          (story) => story.status !== "done" && story.status !== "closed",
        ).length,
      });
    }

    await this.render({
      locals: {
        owner,
        title: owner.title(),
        kind: owner.kind,
        rows,
      },
    });
  }
}
