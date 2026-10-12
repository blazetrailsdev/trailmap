import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.js";
import { Owner } from "../models/owner.js";
import { Repository } from "../models/repository.js";
import { openCountsByRepo } from "../models/concerns/repo-scope.js";

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
 * is. `openCountsByRepo` answers every row with one grouped query.
 */
export class OwnersController extends ApplicationController {
  async show(): Promise<void> {
    const login = String(this.params.get("owner") ?? "");
    const owner = login === "" ? null : await Owner.findByLogin(login);
    if (owner === null) throw new RecordNotFound(`No owner ${login}`);

    const repos = await Repository.where({ owner_id: owner.id }).order("name").toArray();
    const openCounts = await openCountsByRepo(repos.map((repo) => repo.name));
    const rows = [];
    for (const repo of repos) {
      rows.push({
        name: repo.name,
        href: `/${owner.login}/${repo.name}`,
        description: repo.description,
        visibility: repo.visibility,
        defaultBranch: repo.default_branch,
        archived: repo.archived,
        openCount: openCounts.get(repo.name) ?? 0,
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
