import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dir, setEnv } from "@blazetrails/ruby-compat";
import { RecordNotFound } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "../models/schema.js";
import {
  connectHubTestDatabase,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../support/hub-schema.js";
import { Rfc, Story, Event, StoryPath, loadModelSchemas } from "../../app/models/index.js";
import { Owner } from "../../app/models/owner.js";
import { Repository } from "../../app/models/repository.js";
import { RepositorySetting } from "../../app/models/repository-setting.js";
import { RepositoryCollaborator } from "../../app/models/repository-collaborator.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { OwnersController } from "../../app/controllers/owners-controller.js";
import { RepoCodeController } from "../../app/controllers/repo-code-controller.js";
import {
  ISSUES_PAGE_SIZE,
  RepoIssuesController,
} from "../../app/controllers/repo-issues-controller.js";
import { RepoPullsController } from "../../app/controllers/repo-pulls-controller.js";
import { RepoActionsController } from "../../app/controllers/repo-actions-controller.js";
import { RepoProjectsController } from "../../app/controllers/repo-projects-controller.js";
import { RepoWikiController } from "../../app/controllers/repo-wiki-controller.js";
import { RepoInsightsController } from "../../app/controllers/repo-insights-controller.js";
import { RepoSettingsController } from "../../app/controllers/repo-settings-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { Setting } from "../../app/models/setting.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * The eight repo tabs and the owner page, end to end through the framework's
 * own harness: both databases connected, a request routed, a template
 * rendered.
 *
 * Two repositories on purpose. `trails` carries stories whose PR names it, and
 * `tasks` is the CONTENT repo, which additionally owns every story with no PR
 * at all (`app/models/concerns/repo-scope.ts`) — the rule that decides which
 * repository an issue belongs to, and the one thing on these pages that cannot
 * be read off a column.
 */
async function get(
  controller: Parameters<typeof controllerTestCase>[0],
  action: string,
  params: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(controller);
  await tc.get(action, { params });
  return { status: tc.response.status, body: tc.response.body };
}

/** The params every tab needs: whose repo, and which. */
const TRAILS = { owner: "blazetrailsdev", repo: "trails" };
const TASKS = { owner: "blazetrailsdev", repo: "tasks" };

describe.skipIf(!hasHubTestDatabase())("the repo tabs", () => {
  beforeAll(async () => {
    ApplicationController.prependViewPath("app/views");
    // The wiki reads the content tree off disk; this repo stands in for one,
    // as it does in the RFC page's test.
    setEnv("TASKS_DIR", Dir.pwd());

    await migrateScratchDatabase();
    await loadModelSchemas();
    await connectHubTestDatabase();

    const owner = await Owner.create({
      login: "blazetrailsdev",
      kind: "organization",
      display_name: "Blaze Trails",
    });
    for (const name of ["trails", "tasks"]) {
      const repo = await Repository.create({
        owner_id: owner.id,
        name,
        checkout_path: `/checkout/${name}`,
      });
      await RepositorySetting.create({ repository_id: repo.id });
    }

    await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap", priority: 1 });
    // Shipped in `trails`, so an issue of `trails`.
    await Story.create({
      id: "shipped-in-trails",
      rfc_id: "0136-trailmap",
      status: "done",
      title: "A shipped story",
      pr: "trails#7228",
    });
    await Story.create({
      id: "open-in-trails",
      rfc_id: "0136-trailmap",
      status: "in-progress",
      title: "A story under review",
      pr: "trails#7229",
      assignee: "agent",
      est_loc: 120,
    });
    // No PR, so an issue of the content repo.
    await Story.create({
      id: "unshipped",
      rfc_id: "0136-trailmap",
      status: "ready",
      title: "Not started anywhere",
      est_loc: 40,
    });
    await StoryPath.create({ story_id: "open-in-trails", path: "packages/activerecord/src/base.ts" });
    await StoryPath.create({ story_id: "open-in-trails", path: "packages/actionpack/src/x.ts" });
    await Event.create({
      at: new Date().toISOString(),
      verb: "done",
      story_id: "shipped-in-trails",
      pr: "trails#7228",
      actor: "agent",
    });
  });
  // Hands the hub to the next test file; see `releaseHubTestDatabase`.
  afterAll(releaseHubTestDatabase);

  it("serves the owner page with a row per repository", async () => {
    const { status, body } = await get(OwnersController, "show", { owner: "blazetrailsdev" });

    expect(status).toBe(200);
    expect(body).toContain("Blaze Trails");
    expect(body).toContain('href="/blazetrailsdev/trails"');
    expect(body).toContain('href="/blazetrailsdev/tasks"');
  });

  it("404s an unknown owner", async () => {
    await expect(get(OwnersController, "show", { owner: "nobody" })).rejects.toThrow(
      RecordNotFound,
    );
  });

  it("serves the code tab with the repository and the directories its work cites", async () => {
    const { status, body } = await get(RepoCodeController, "show", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("/checkout/trails");
    // Both cited paths are under `packages`, counted as one directory.
    expect(body).toContain("packages");
  });

  it("scopes issues by the PR's repository, and the content repo keeps the unshipped ones", async () => {
    const trails = await get(RepoIssuesController, "index", TRAILS);
    expect(trails.status).toBe(200);
    expect(trails.body).toContain("A story under review");
    expect(trails.body).not.toContain("Not started anywhere");

    const tasks = await get(RepoIssuesController, "index", TASKS);
    expect(tasks.body).toContain("Not started anywhere");
    expect(tasks.body).not.toContain("A story under review");
  });

  it("counts open and closed issues as GitHub does, over the whole tab", async () => {
    const open = await get(RepoIssuesController, "index", TRAILS);
    expect(open.body).toContain("1 Open");
    expect(open.body).toContain("1 Closed");

    const closed = await get(RepoIssuesController, "index", { ...TRAILS, state: "closed" });
    expect(closed.body).toContain("A shipped story");
    expect(closed.body).not.toContain("A story under review");
  });

  it("pages the issues list, counting the whole tab rather than the page", async () => {
    // `trails` has 9,163 closed stories on the live database, and the first
    // draft of this page drew every one of them — seven megabytes of HTML.
    const extra = ISSUES_PAGE_SIZE + 5;
    for (let n = 0; n < extra; n += 1) {
      await Story.create({
        id: `bulk-${String(n).padStart(3, "0")}`,
        rfc_id: "0136-trailmap",
        status: "ready",
        title: `Bulk story ${n}`,
        pr: `trails#${9000 + n}`,
      });
    }
    try {
      const first = await get(RepoIssuesController, "index", TRAILS);
      // The count is the tab's, not the page's: one pre-existing open story
      // plus the bulk.
      expect(first.body).toContain(`${extra + 1} Open`);
      expect(first.body).toContain("Bulk story 0");
      expect(first.body).not.toContain("Bulk story 104");
      expect(first.body).toContain("page 1 of 2");

      const second = await get(RepoIssuesController, "index", { ...TRAILS, page: "2" });
      expect(second.body).toContain("Bulk story 104");
      expect(second.body).not.toContain("Bulk story 0<");

      // A page past the end is the last page, not a blank one — a bookmarked
      // `page=9` must not go empty because stories shipped.
      const past = await get(RepoIssuesController, "index", { ...TRAILS, page: "9" });
      expect(past.body).toContain("page 2 of 2");
    } finally {
      for (let n = 0; n < extra; n += 1) {
        await (await Story.findBy({ id: `bulk-${String(n).padStart(3, "0")}` }))?.destroy();
      }
    }
  });

  it("lets a Setting row override RINGO_BASE for the pages that relay ringo", async () => {
    // The point of the `settings` table: the row is not something the settings
    // page merely displays. The dashboard resolves ringo's origin through
    // `Setting.ringoBase()`, so with neither a row nor the variable it reports
    // no relay, and a row alone is enough to turn it on.
    setEnv("RINGO_BASE", "");
    const without = await get(DashboardController, "index", {});
    expect(without.body).toContain("No fleet data");

    await Setting.write("ringo_base", "http://btwhooks.web:8080");
    try {
      const withRow = await get(DashboardController, "index", {});
      expect(withRow.body).not.toContain("No fleet data");
    } finally {
      await Setting.write("ringo_base", null);
    }
  });

  it("serves one issue, and 404s a story that is not there", async () => {
    const found = await get(RepoIssuesController, "show", { ...TRAILS, id: "open-in-trails" });
    expect(found.status).toBe(200);
    expect(found.body).toContain("A story under review");
    expect(found.body).toContain("agent");

    const missing = await get(RepoIssuesController, "show", { ...TRAILS, id: "nope" });
    expect(missing.status).toBe(404);
  });

  it("groups pull requests by their ref and calls one merged when every story is", async () => {
    const open = await get(RepoPullsController, "index", TRAILS);
    expect(open.status).toBe(200);
    expect(open.body).toContain("#7229");
    expect(open.body).not.toContain("#7228");

    const merged = await get(RepoPullsController, "index", { ...TRAILS, state: "merged" });
    expect(merged.body).toContain("#7228");

    const one = await get(RepoPullsController, "show", { ...TRAILS, id: "7228" });
    expect(one.status).toBe(200);
    expect(one.body).toContain("A shipped story");
  });

  it("serves the actions tab from the events table", async () => {
    const { status, body } = await get(RepoActionsController, "index", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("done");
    expect(body).toContain("A shipped story");
  });

  it("serves projects as the RFCs whose work touches the repo, with the RFC's own counts", async () => {
    const { status, body } = await get(RepoProjectsController, "index", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("trailmap");
    // The RFC's own total is three stories, one done — not the repo's two.
    expect(body).toContain("1/3 done");

    const board = await get(RepoProjectsController, "show", {
      ...TRAILS,
      id: "0136-trailmap",
    });
    expect(board.status).toBe(200);
    expect(board.body).toContain("A shipped story");
    expect(board.body).not.toContain("Not started anywhere");
  });

  it("serves the wiki index, and a page when one is asked for", async () => {
    const index = await get(RepoWikiController, "index", TRAILS);
    expect(index.status).toBe(200);
    expect(index.body).toContain("0136-trailmap");

    // No `file_path` on this RFC, so there is no body to render — the index
    // still serves, which is the point: a missing document is not a 500.
    const page = await get(RepoWikiController, "index", { ...TRAILS, page: "0136-trailmap" });
    expect(page.status).toBe(200);
  });

  it("serves the insights tab with the repo's status spread", async () => {
    const { status, body } = await get(RepoInsightsController, "show", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("120 loc");
    expect(body).toContain("in-progress");
  });

  it("lists collaborators on the settings tab, from the composite-key join", async () => {
    const repo = await Repository.findByNwo("blazetrailsdev", "trails");
    const member = await Owner.create({ login: "a-collaborator", kind: "user" });
    await RepositoryCollaborator.create({
      repository_id: repo!.id,
      owner_id: member.id,
      role: "write",
    });

    const { status, body } = await get(RepoSettingsController, "show", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("a-collaborator");
    expect(body).toContain("write");
    // A read-only collaborator is marked as such; `write` is not.
    expect(body).not.toContain("read-only");
  });

  it("serves the settings tab with the switches and where each global value comes from", async () => {
    setEnv("RINGO_BASE", "http://ringo.test:8080");
    const { status, body } = await get(RepoSettingsController, "show", TRAILS);

    expect(status).toBe(200);
    expect(body).toContain("ringo_base");
    expect(body).toContain("http://ringo.test:8080");
    expect(body).toContain("RINGO_BASE (environment)");
  });

  it("404s an unknown repository, and a tab its owner turned off", async () => {
    await expect(
      get(RepoIssuesController, "index", { owner: "blazetrailsdev", repo: "nothing" }),
    ).rejects.toThrow(RecordNotFound);

    const repo = await Repository.findByNwo("blazetrailsdev", "tasks");
    await repo!.settings!.update({ issues_enabled: false });
    try {
      await expect(get(RepoIssuesController, "index", TASKS)).rejects.toThrow(RecordNotFound);
      // The tab is also gone from the bar every other tab draws, so nothing
      // links to a page that refuses.
      const code = await get(RepoCodeController, "show", TASKS);
      expect(code.body).not.toContain('href="/blazetrailsdev/tasks/issues"');
    } finally {
      await repo!.settings!.update({ issues_enabled: true });
    }
  });
});
