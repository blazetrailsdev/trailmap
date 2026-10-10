import { Owner } from "../app/models/owner.js";
import { Repository } from "../app/models/repository.js";
import { RepositorySetting } from "../app/models/repository-setting.js";
import { RepositoryCollaborator } from "../app/models/repository-collaborator.js";
import { Hub } from "../app/models/hub.js";
import { loadHubSchemas } from "../app/models/index.js";
import { hasHubDatabase, hubDatabaseConfig } from "../config/database.js";

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
  // `trails db seed` runs this file against the PRIMARY pool and loads no
  // initializers, so `config/initializers/hub-database.ts` has not run and
  // `Hub` has no connection — every query below would fall through to the
  // SQLite primary and fail on "no such table: owners". Establish it here.
  await Hub.establishConnection(hubDatabaseConfig());
  await loadHubSchemas();

  const owner =
    (await Owner.findByLogin("blazetrailsdev")) ??
    (await Owner.create({
      login: "blazetrailsdev",
      kind: "organization",
      display_name: "Blaze Trails",
      description: "trails, the task system, and the fleet that builds them.",
    }));

  // The repos the task domain cites whether or not this box runs the fleet:
  // `stories.pr` is `repo#N` over exactly these names, so a backlog row has
  // somewhere to point even where `FLEET_REPO_PATHS` is unset.
  const known: Array<[string, string]> = [
    ["trails", "The framework. Rails, in TypeScript."],
    ["trailmap", "The task domain as a trails application — this app."],
    ["tasks", "RFCs, stories and the CLI that ingests them."],
    ["ringo", "The fleet's webhook process and dashboard."],
  ];
  for (const [name, description] of known) {
    const existing = await Repository.findByNwo(owner.login, name);
    if (existing) {
      await existing.update({ description });
      continue;
    }
    const repo = await Repository.create({ owner_id: owner.id, name, description });
    await RepositorySetting.create({ repository_id: repo.id });
  }

  // One collaborator, so the settings tab's composite-key join has a row to
  // show. `dean` is the account the fleet's work is authored under; admin on
  // every repository the org owns.
  const dean =
    (await Owner.findByLogin("dean")) ??
    (await Owner.create({ login: "dean", kind: "user", display_name: "Dean Marano" }));
  for (const repo of await Repository.where({ owner_id: owner.id }).toArray()) {
    const existing = await RepositoryCollaborator.where({
      repository_id: repo.id,
      owner_id: dean.id,
    }).first();
    if (!existing) {
      await RepositoryCollaborator.create({
        repository_id: repo.id,
        owner_id: dean.id,
        role: "admin",
      });
    }
  }

  const imported = await Repository.importFleetRepos();
  console.log(
    `seeded ${owner.login}: ${known.length} repositories, ` +
      `${imported.length} from FLEET_REPO_PATHS`,
  );

  // Hand the hub pool back. `trails db seed` knows only about the primary
  // connection, so the one established above keeps its sockets — and the
  // process — alive after the seeds finish, and the command never exits.
  await Hub.removeConnection();
}
