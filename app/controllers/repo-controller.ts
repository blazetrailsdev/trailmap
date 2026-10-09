import type { AbstractController } from "@blazetrails/actionpack";
import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.js";
import { Repository } from "../models/repository.js";
import {
  ALL_TABS_ENABLED,
  OPTIONAL_TABS,
  type TabSwitches,
} from "../models/repository-setting.js";

/** One entry of the tab bar. */
export interface RepoTab {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

/**
 * The base of the eight tab controllers under `/:owner/:repo`.
 *
 * Every tab needs the same three things before it can render anything: the
 * repository the path names, its owner, and the tab bar — which depends on the
 * repo's settings, since a tab that is switched off is not drawn and not
 * served. Doing that once here is the point of the class; `scope(..., { module:
 * "repos" })` in config/routes.ts is what lets the subclasses be named after
 * their tab.
 *
 * A subclass declares its own `tab`, and the `beforeAction` below uses it for
 * both the switch check and which entry of the bar is marked active. A missing
 * repository, a missing owner and a disabled tab are all 404s: on GitHub they
 * are indistinguishable from the outside, and deliberately so — a 403 would
 * tell an anonymous reader that a private repository with that name exists.
 */
export class RepoController extends ApplicationController {
  /** The tab this controller serves. Overridden by every subclass. */
  static tab = "code";

  declare repo: Repository;
  declare tabs: RepoTab[];

  static {
    this.beforeAction(loadRepository);
  }

  /**
   * The locals every tab's template needs, merged into whatever the action
   * adds. `repo` and `tabs` are what `repos/_header` renders.
   */
  protected repoLocals(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      repo: this.repo,
      owner: this.repo.owner,
      nwo: this.repo.nameWithOwner(),
      tabs: this.tabs,
      ...extra,
    };
  }
}

/** Human labels for the tab bar; the keys are the route segments. */
const TAB_LABELS: ReadonlyArray<[string, string, string]> = [
  ["code", "Code", ""],
  ["issues", "Issues", "/issues"],
  ["pulls", "Pull requests", "/pulls"],
  ["actions", "Actions", "/actions"],
  ["projects", "Projects", "/projects"],
  ["wiki", "Wiki", "/wiki"],
  ["insights", "Insights", "/pulse"],
  ["settings", "Settings", "/settings"],
];

/**
 * Resolve `:owner`/`:repo` into the record, refuse a tab that is switched off,
 * and build the tab bar.
 *
 * An unknown owner, an unknown repository and a disabled tab all raise
 * `RecordNotFound`, which the ActiveRecord trailtie maps to 404
 * (`rescueResponses`, trailties/active-record.ts). Raising rather than
 * rendering is what keeps this a before-action at all: it has no template of
 * its own to render, and naming one here would be the `template:` argument this
 * codebase does not use.
 *
 * All three are the same status on purpose, as they are on GitHub: a 403 on a
 * private repository tells an anonymous reader that it exists.
 */
async function loadRepository(
  controller: AbstractController.AbstractController,
): Promise<boolean> {
  const base = controller as unknown as RepoController & {
    params: { get(key: string): unknown };
  };
  const tab = (controller.constructor as typeof RepoController).tab;

  const login = String(base.params.get("owner") ?? "");
  const name = String(base.params.get("repo") ?? "");
  const repo = login === "" || name === "" ? null : await Repository.findByNwo(login, name);

  if (repo === null) throw new RecordNotFound(`No repository ${login}/${name}`);
  if (!switchesOf(repo).enabled(tab)) {
    throw new RecordNotFound(`${login}/${name} has its ${tab} tab turned off`);
  }

  base.repo = repo;
  base.tabs = tabsFor(repo, tab);
  return true;
}

/** A repo's switches, or everything-on when its row has not been written. */
function switchesOf(repo: Repository): TabSwitches {
  return repo.settings ?? ALL_TABS_ENABLED;
}

/** The tab bar: every enabled tab, in GitHub's order, with this one marked. */
function tabsFor(repo: Repository, current: string): RepoTab[] {
  const switches = switchesOf(repo);
  const prefix = `/${repo.nameWithOwner()}`;
  return TAB_LABELS.filter(([key]) => switches.enabled(key)).map(([key, label, suffix]) => ({
    key,
    label,
    href: `${prefix}${suffix}`,
    active: key === current,
  }));
}

export { OPTIONAL_TABS };
