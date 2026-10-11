import { Owner } from "../app/models/owner.js";
import { Repository } from "../app/models/repository.js";
import { RepositorySetting } from "../app/models/repository-setting.js";
import { RepositoryCollaborator } from "../app/models/repository-collaborator.js";
import { CONTENT_REPO } from "../app/models/concerns/repo-scope.js";
import { env } from "@blazetrails/ruby-compat";
import { hasHubDatabase } from "../config/database.js";

/**
 * The `hub` database's seeds: the owner and the repositories the fleet works
 * on. Nothing seeds the task domain — those rows come from `tasks ingest`.
 *
 * Idempotent, because this is also how a box's repo list is refreshed after
 * `FLEET_REPO_PATHS` changes. `importFleetRepos` upserts and never deletes;
 * see the note on it.
 */
if (!hasHubDatabase()) {
  console.log("HUB_DATABASE_URL is not set — nothing to seed.");
} else {
  // `createBang`, not `create`, everywhere below: `create` answers an UNSAVED
  // record when a validation fails, so a seed run against a schema the models
  // have outgrown would print "seeded" and leave an empty database.
  const owner =
    (await Owner.findByLogin("blazetrailsdev")) ??
    (await Owner.createBang({
      login: "blazetrailsdev",
      kind: "organization",
      display_name: "Blaze Trails",
      description: "trails, the task system, and the fleet that builds them.",
    }));

  // The repos the task domain cites whether or not this box runs the fleet:
  // `stories.pr` is `repo#N` over exactly these names, so a backlog row has
  // somewhere to point even where `FLEET_REPO_PATHS` is unset.
  // `CONTENT_REPO` rather than a second literal "tasks": the scope in
  // `repo-scope.ts` treats that one name specially (unattributed stories count
  // as its own), so a seed file spelling it independently is a rename away
  // from seeding a repository the scope no longer recognises.
  const known: Array<[string, string]> = [
    ["trails", "The framework. Rails, in TypeScript."],
    ["trailmap", "The task domain as a trails application — this app."],
    [CONTENT_REPO, "RFCs, stories and the CLI that ingests them."],
    ["ringo", "The fleet's webhook process and dashboard."],
  ];
  for (const [name, description] of known) {
    const existing = await Repository.findByNwo(owner.login, name);
    if (existing) {
      // Only FILLS a blank description; it never overwrites one. These seeds
      // are also how a box refreshes its repo list, and clobbering an edited
      // description on every run makes the field unusable for anything but
      // this file's opinion of it.
      if (existing.description === null || existing.description.trim() === "") {
        await existing.updateBang({ description });
      }
      continue;
    }
    const repo = await Repository.createBang({ owner_id: owner.id, name, description });
    await RepositorySetting.createBang({ repository_id: repo.id });
  }

  // One collaborator, so the settings tab's composite-key join has a row to
  // show: admin on every repository the org owns.
  //
  // Who that is comes from the environment, defaulting to the account this
  // fleet's work is authored under. The login was hard-coded in three places
  // here, which made a seeded database a statement about one person rather
  // than about the box it runs on.
  const adminLogin = env.SEED_ADMIN_LOGIN?.trim() || "dean";
  const adminName = env.SEED_ADMIN_NAME?.trim() || "Dean Marano";
  const admin =
    (await Owner.findByLogin(adminLogin)) ??
    (await Owner.createBang({ login: adminLogin, kind: "user", display_name: adminName }));
  for (const repo of await Repository.where({ owner_id: owner.id }).toArray()) {
    const existing = await RepositoryCollaborator.where({
      repository_id: repo.id,
      owner_id: admin.id,
    }).first();
    if (!existing) {
      await RepositoryCollaborator.createBang({
        repository_id: repo.id,
        owner_id: admin.id,
        role: "admin",
      });
    }
  }

  const imported = await Repository.importFleetRepos();
  console.log(
    `seeded ${owner.login}: ${known.length} repositories, ` +
      `${imported.length} from FLEET_REPO_PATHS`,
  );
}
