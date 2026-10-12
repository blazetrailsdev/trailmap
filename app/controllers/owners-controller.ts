import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.js";
import { Owner } from "../models/owner.js";
import { Repository } from "../models/repository.js";
import { viewerOf } from "./concerns/viewer.js";
import { openCountForRepo } from "../models/concerns/repo-scope.js";

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
 * is. It is a COUNT per repository — `openCountForRepo`, not
 * `storiesForRepo(…).filter(…)`, which plucked eight columns of nine thousand
 * `trails` stories per row to arrive at one integer.
 *
 * Only the repositories the viewer can read are listed
 * (`Repository#isReadableBy`): a private one is not a row with a `private`
 * tag for a stranger, it is not a row, and the tab pages 404 it to match.
 *
 * Still one query per repository, which is fine at four and would not be at
 * four hundred; the day that matters it becomes one grouped query.
 */
export class OwnersController extends ApplicationController {
  async show(): Promise<void> {
    const login = String(this.params.get("owner") ?? "");
    const owner = login === "" ? null : await Owner.findByLogin(login);
    if (owner === null) throw new RecordNotFound(`No owner ${login}`);

    const repos = await Repository.where({ owner_id: owner.id }).order("name").toArray();
    const viewer = await viewerOf(this.request);
    const rows = [];
    for (const repo of repos) {
      if (!(await repo.isReadableBy(viewer))) continue;
      rows.push({
        name: repo.name,
        href: `/${owner.login}/${repo.name}`,
        description: repo.description,
        visibility: repo.visibility,
        defaultBranch: repo.default_branch,
        archived: repo.archived,
        openCount: await openCountForRepo(repo.name),
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
