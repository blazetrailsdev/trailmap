import { RepoController } from "./repo-controller.js";
import { OPTIONAL_TABS } from "../models/repository-setting.js";
import { Setting } from "../models/setting.js";
import { RepositoryCollaborator } from "../models/repository-collaborator.js";

/**
 * `/:owner/:repo/settings` — the repository's record and its feature switches.
 *
 * READ-ONLY in this change, and the switches are already load-bearing: a tab
 * turned off here is not drawn in the bar and 404s when asked for
 * (`repo-controller.ts`). The form that writes them is its own story,
 * because a write needs the CSRF path, a strong-parameters permit and a
 * redirect-after-post, none of which this page has.
 *
 * It also shows the application-wide settings (`Setting`) and where each one's
 * value is coming from. That answer is the reason the model exists: a row
 * overrides the environment variable, so an operator looking at a wrong ringo
 * origin needs to know which of the two they are reading.
 */
export class RepoSettingsController extends RepoController {
  static tab = "settings";

  async show(): Promise<void> {
    const switches = this.repo.settings;

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
        collaborators: collaborators
          .map((c) => ({
            login: c.owner?.login ?? String(c.owner_id),
            role: c.role,
            canPush: c.canPush(),
          }))
          .sort((a, b) => a.login.localeCompare(b.login)),
        // `null` when the row has not been written: the tabs are all on, and
        // the page says so rather than drawing six switches that do not exist.
        hasSwitches: switches !== null,
        switches: OPTIONAL_TABS.map((tab) => ({
          tab,
          enabled: switches === null ? true : switches.enabled(tab),
        })),
        global,
      }),
    });
  }
}
