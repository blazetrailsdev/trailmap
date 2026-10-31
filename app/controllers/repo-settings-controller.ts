import type { ActionController } from "@blazetrails/actionpack";
import { RepoController } from "./repo-controller.ts";
import { OPTIONAL_TABS, RepositorySetting } from "../models/repository-setting.ts";
import { Setting } from "../models/setting.ts";
import { RepositoryCollaborator } from "../models/repository-collaborator.ts";
import { RecordNotFound } from "@blazetrails/activerecord";
import { viewerOf } from "./concerns/viewer.ts";

/**
 * `/:owner/:repo/settings` — the repository's record and its feature switches.
 *
 * The switches are load-bearing: a tab turned off here is not drawn in the
 * bar and 404s when asked for (`repo-controller.ts`). `update` writes them
 * from the page's form — through the framework's forgery protection, a
 * strong-parameters permit and a redirect-after-post.
 *
 * It also shows the application-wide settings (`Setting`) and where each one's
 * value is coming from. That answer is the reason the model exists: a row
 * overrides the environment variable, so an operator looking at a wrong ringo
 * origin needs to know which of the two they are reading.
 */
export class RepoSettingsController extends RepoController {
  static tab = "settings";

  async show(): Promise<void> {
    const switches = await this.repo.settings;

    // One `resolve` per key: it answers the value and its source together,
    // so this page cannot disagree with the resolver about what is in effect.
    const global = [];
    for (const key of Object.keys(Setting.FALLBACKS)) {
      const { value, source } = await Setting.resolve(key);
      global.push({
        key,
        value,
        from:
          source === "database"
            ? "this database"
            : `${Setting.FALLBACKS[key]} (environment)`,
      });
    }

    // Collaborators, as GitHub lists them under settings. `includes("owner")`
    // loads the logins with them: an earlier comment here claimed the owner
    // side was "a second hub table" and had to be fetched separately, which
    // was simply wrong — `owners` and `repository_collaborators` are both in
    // the hub, on one connection, and `belongsTo("owner")` spans them like
    // any other association.
    const collaborators = await RepositoryCollaborator.where({
      repository_id: this.repo.id,
    })
      .includes("owner")
      .toArray();

    await this.render({
      locals: this.repoLocals({
        collaborators: (
          await Promise.all(
            collaborators.map(async (c) => ({
              login: (await c.owner)?.login ?? String(c.owner_id),
              role: c.role,
              canPush: c.canPush(),
            })),
          )
        ).sort((a, b) => a.login.localeCompare(b.login)),
        // `null` when the row has not been written: the tabs are all on, and
        // the page says so rather than drawing six switches that do not exist.
        hasSwitches: switches !== null,
        // The form's model: the row, or an unsaved one whose column defaults
        // (all on) are what `ALL_TABS_ENABLED` answers for a missing row.
        form: switches ?? new RepositorySetting({ repository_id: this.repo.id }),
        canAdminister: await this.repo.isAdministrableBy(await viewerOf(this.request)),
        switches: OPTIONAL_TABS.map((tab) => ({
          tab,
          enabled: switches === null ? true : switches.enabled(tab),
        })),
        global,
      }),
    });
  }

  /**
   * `PATCH /:owner/:repo/settings`, for the owner or an admin collaborator
   * only (`Repository#isAdministrableBy`); anyone else gets the same 404 as
   * every other refusal here. A repository with no row gets one on its
   * first save. The redirect is back to the tab, as Rails' scaffold does, so a
   * reload does not resubmit, and the next request reads the row afresh —
   * `loadRepository` preloads it per request, so no restart is involved.
   *
   * The application settings (`Setting`) are global and are NOT written here:
   * a per-repository PATCH that could write them would let one repository's
   * page change every other's behaviour.
   */
  async update(): Promise<void> {
    if (!(await this.repo.isAdministrableBy(await viewerOf(this.request)))) {
      throw new RecordNotFound(`${this.nwo} has no settings this viewer may change`);
    }
    const row = (await this.repo.settings) ?? this.repo.buildSettings();
    await row.updateBang(this.switchParams());
    this.redirectTo(this.repoSettingsPath(this.repoOwner.login, this.repo.name), { status: 303 });
  }

  /**
   * Exactly the six switches. `repository_id` and `id` are never permitted, so
   * a form that names them cannot move the row to another repository.
   */
  private switchParams(): Record<string, unknown> {
    const scoped = this.params.require("repository_setting") as ActionController.Parameters;
    return scoped.permit(...OPTIONAL_TABS.map((tab) => `${tab}_enabled`)).toHash() as Record<string, unknown>;
  }
}
