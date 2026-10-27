import type { AbstractController } from "@blazetrails/actionpack";
import { RecordNotFound } from "@blazetrails/activerecord";
import { ApplicationController } from "./application-controller.ts";
import { Repository } from "../models/repository.ts";
import { viewerOf } from "./concerns/viewer.ts";
import { ALL_TABS_ENABLED, type TabSwitches } from "../models/repository-setting.ts";

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
 * served. Doing that once here is the point of the class.
 *
 * The subclasses are FLAT (`RepoIssuesController`, not `Repos::Issues`) and
 * config/routes.ts says why: a `module`-scoped controller routes under one
 * name and looks its views up under another.
 *
 * A subclass declares its own `tab`, and the `beforeAction` below uses it for
 * both the switch check and which entry of the bar is marked active. A missing
 * repository, a missing owner, a repository the viewer may not read and a
 * disabled tab are all 404s: the four are indistinguishable from the outside,
 * which is one less thing for a reader — or a test — to have to tell apart,
 * and for a private repository is the point.
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
   * adds. `repo` and `tabs` are what `shared/_repo-header` renders.
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
 * Resolve `:owner`/`:repo` into the record, refuse a repository the viewer may
 * not read and a tab that is switched off, and build the tab bar.
 *
 * An unknown owner, an unknown repository, an unreadable one and a disabled
 * tab all raise `RecordNotFound`, which the ActiveRecord trailtie maps to 404
 * (`rescueResponses`, trailties/active-record.ts). Raising rather than
 * rendering is what keeps this a before-action at all: it has no template of
 * its own to render, and naming one here would be the `template:` argument this
 * codebase does not use.
 *
 * All four are the same status on purpose: there is one way to fail to reach
 * a page here, so there is one status.
 *
 * VISIBILITY IS ENFORCED HERE, once, for all eight tabs — a subclass cannot
 * serve a repository this refused, because it never gets `this.repo`. The
 * viewer is whoever Authelia signed in (`concerns/viewer.ts`) and the rule is
 * `Repository#isReadableBy`: public, or owned by the viewer, or shared with
 * them through a `repository_collaborators` row. A private repository answers
 * 404 and not 403 because a 403 confirms to a stranger that it exists, and its
 * message is the unknown repository's for the same reason.
 */
async function loadRepository(
  controller: AbstractController.Base,
): Promise<boolean> {
  const base = controller as unknown as RepoController & {
    params: { get(key: string): unknown };
    request: { getHeader(key: string): unknown };
  };
  const tab = (controller.constructor as typeof RepoController).tab;

  const login = String(base.params.get("owner") ?? "");
  const name = String(base.params.get("repo") ?? "");
  const repo = login === "" || name === "" ? null : await Repository.findByNwo(login, name);

  if (repo === null || !(await repo.isReadableBy(await viewerOf(base.request)))) {
    throw new RecordNotFound(`No repository ${login}/${name}`);
  }
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
