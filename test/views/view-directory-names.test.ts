import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";
import { PanesController } from "../../app/controllers/panes-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";
import { OwnersController } from "../../app/controllers/owners-controller.js";
import { RepoActionsController } from "../../app/controllers/repo-actions-controller.js";
import { RepoCodeController } from "../../app/controllers/repo-code-controller.js";
import { RepoInsightsController } from "../../app/controllers/repo-insights-controller.js";
import { RepoIssuesController } from "../../app/controllers/repo-issues-controller.js";
import { RepoProjectsController } from "../../app/controllers/repo-projects-controller.js";
import { RepoPullsController } from "../../app/controllers/repo-pulls-controller.js";
import { RepoSettingsController } from "../../app/controllers/repo-settings-controller.js";
import { RepoWikiController } from "../../app/controllers/repo-wiki-controller.js";
import { ParityGraphsController } from "../../app/controllers/parity-graphs-controller.js";
import { AuditsController } from "../../app/controllers/audits-controller.js";

/**
 * Every page controller's view directory is the one the implicit lookup asks
 * for, so no render has to name its template — and it is kebab-case, like
 * every other filename here.
 *
 * Two things are true at once, and this suite holds both:
 *
 * - The VIEW prefix is kebab-case. That is the framework's spelling since
 *   trails#8670, and trailmap overrides nothing to get it.
 * - `controllerPath` is untouched. It also names the controller in routes,
 *   where a hyphen is not legal, and `ActionController::TestCase` generates the
 *   request's route from it. trailmap overrode `controllerPath` first, and no
 *   page controller could then be tested through the framework's own harness.
 *
 * It fails on a directory spelled with an underscore, on a controller added
 * without a directory, on a trails pin whose lookup is underscored again, on a
 * `localPrefixes` override coming back, and on a `controllerPath` override
 * coming back.
 */
const PAGE_CONTROLLERS = [
  AuditsController,
  DashboardController,
  HomeController,
  PanesController,
  RfcPagesController,
  StoryPagesController,
  OwnersController,
  RepoCodeController,
  RepoIssuesController,
  RepoPullsController,
  RepoActionsController,
  RepoProjectsController,
  RepoWikiController,
  RepoInsightsController,
  RepoSettingsController,
  ParityGraphsController,
];

/** The two directories that back no controller: layouts and shared partials. */
const NOT_A_CONTROLLER = ["layouts", "shared"];

const VIEWS = "app/views";

/** The directory a controller's own views are looked up in: its first prefix. */
function viewDirectory(controller: { _prefixes(): string[] }): string {
  return controller._prefixes()[0]!;
}

/** The directory names directly under `app/views`. */
async function viewDirectories(): Promise<string[]> {
  const fs = getFs();
  const names = await fs.readdir!(VIEWS);
  const directories: string[] = [];
  for (const name of names) {
    const stat = await fs.stat!(`${VIEWS}/${name}`);
    if (stat.isDirectory()) directories.push(name);
  }
  return directories.sort();
}

describe("app/views", () => {
  it("looks views up under a kebab-case prefix, the spelling every other filename uses", () => {
    expect(viewDirectory(RfcPagesController)).toBe("rfc-pages");
    expect(viewDirectory(StoryPagesController)).toBe("story-pages");
    // A single-word controller has no separator to respell.
    expect(viewDirectory(HomeController)).toBe("home");
  });

  it("stops the prefix chain at ApplicationController, as Rails does", () => {
    expect(RfcPagesController._prefixes()).toEqual(["rfc-pages", "application"]);
  });

  it("gives each repo tab its own directory, with the shared base's in the chain", () => {
    // `repo` is RepoController's prefix and backs no directory: it is an
    // abstract base, like ApplicationController, and the orphan check below
    // would otherwise demand `app/views/repo`.
    expect(RepoIssuesController._prefixes()).toEqual([
      "repo-issues",
      "repo",
      "application",
    ]);
    expect(viewDirectory(RepoInsightsController)).toBe("repo-insights");
  });

  it("names the tab controllers after the tab they serve", () => {
    const tabs = [
      RepoCodeController,
      RepoIssuesController,
      RepoPullsController,
      RepoActionsController,
      RepoProjectsController,
      RepoWikiController,
      RepoInsightsController,
      RepoSettingsController,
    ];
    // Every tab's `tab` is its own, and matches the directory it renders from:
    // the switch check in `loadRepository` reads that field, so a controller
    // that inherited the base's `code` would serve a tab its owner turned off.
    expect(tabs.map((controller) => controller.tab)).toEqual([
      "code",
      "issues",
      "pulls",
      "actions",
      "projects",
      "wiki",
      "insights",
      "settings",
    ]);
    for (const controller of tabs) {
      expect(viewDirectory(controller)).toBe(`repo-${controller.tab}`);
    }
  });

  it("leaves controllerPath, which routes and tests read, as the framework derives it", () => {
    expect(RfcPagesController.controllerPath()).toBe("rfc_pages");
    expect(StoryPagesController.controllerPath()).toBe("story_pages");
    expect(Object.hasOwn(ApplicationController, "controllerPath")).toBe(false);
  });

  it("takes the kebab-case prefix from the framework, with no override of its own", () => {
    expect(Object.hasOwn(ApplicationController, "localPrefixes")).toBe(false);
  });

  it("names each page controller's directory the way the implicit lookup does", async () => {
    const present = new Set(await viewDirectories());
    const missing = PAGE_CONTROLLERS.map(viewDirectory).filter(
      (prefix) => !present.has(prefix),
    );
    expect(missing).toEqual([]);
  });

  it("has no directory the implicit lookup would never reach", async () => {
    const owned = new Set([
      ...PAGE_CONTROLLERS.map(viewDirectory),
      ...NOT_A_CONTROLLER,
    ]);
    const orphans = (await viewDirectories()).filter((name) => !owned.has(name));
    expect(orphans).toEqual([]);
  });
});
