import { RepoController } from "./repo-controller.js";
import { OPTIONAL_TABS } from "../models/repository-setting.js";
import { Setting } from "../models/setting.js";
import { Owner } from "../models/owner.js";
import { RepositoryCollaborator } from "../models/repository-collaborator.js";

/**
 * `/:owner/:repo/settings` — the repository's record and its feature switches.
 *
 * READ-ONLY in this change, and the switches are already load-bearing: a tab
 * turned off here is not drawn in the bar and 404s when asked for
 * (`repos/repo-controller.ts`). The form that writes them is its own story,
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

    const global: Array<{ key: string; value: string | null; from: string }> = [];
    for (const key of Object.keys(Setting.FALLBACKS)) {
      const row = await Setting.findBy({ key });
      const stored = row?.value?.trim();
      global.push({
        key,
        value: await Setting.lookup(key),
        from: stored ? "this database" : `${Setting.FALLBACKS[key]} (environment)`,
      });
    }

    // Collaborators, as GitHub lists them under settings. Two queries rather
    // than an association include: the join's owner side is a second hub
    // table, and `collaborators` carries only ids.
    const collaborators = await RepositoryCollaborator.where({
      repository_id: this.repo.id,
    }).toArray();
    const logins = new Map(
      (await Owner.where({ id: collaborators.map((c) => c.owner_id) }).toArray()).map((o) => [
        o.id,
        o.login,
      ]),
    );

    await this.render({
      locals: this.repoLocals({
        collaborators: collaborators
          .map((c) => ({
            login: logins.get(c.owner_id) ?? String(c.owner_id),
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
