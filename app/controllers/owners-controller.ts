import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.ts";
import { Owner } from "../models/owner.ts";
import { Repository } from "../models/repository.ts";
import { viewerOf } from "./concerns/viewer.ts";
import { openCountsByRepo } from "../models/concerns/repo-scope.ts";

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
 *
 * Only the repositories the viewer can read are listed
 * (`Repository#isReadableBy`): a private one is not a row with a `private`
 * tag for a stranger, it is not a row, and the tab pages 404 it to match.
 */
export class OwnersController extends ApplicationController {
  async show(): Promise<void> {
    const login = String(this.params.get("owner") ?? "");
    const owner = login === "" ? null : await Owner.findByLogin(login);
    if (owner === null) throw new RecordNotFound(`No owner ${login}`);

    const all = await Repository.where({ owner_id: owner.id }).order("name").toArray();
    const viewer = await viewerOf(this.request);
    const repos = [];
    for (const repo of all) if (await repo.isReadableBy(viewer)) repos.push(repo);
    const openCounts = await openCountsByRepo(repos.map((repo) => repo.name));
    const rows = [];
    for (const repo of repos) {
      rows.push({
        name: repo.name,
        href: this.repoCodePath(owner.login, repo.name),
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
