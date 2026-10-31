import { ConnectionNotDefined } from "@blazetrails/activerecord";
import { Hub } from "./hub.ts";
import { Owner } from "./owner.ts";
import { RepositorySetting } from "./repository-setting.ts";
import { RepositoryCollaborator } from "./repository-collaborator.ts";
import { fleetRepos, type FleetRepo } from "../../config/fleet.ts";

export const REPOSITORY_VISIBILITIES = ["public", "private"] as const;
export type RepositoryVisibility = (typeof REPOSITORY_VISIBILITIES)[number];

/**
 * One repository under an owner: `/blazetrailsdev/trails` and the eight tabs
 * beneath it.
 *
 * This is where `FLEET_REPO_PATHS` ends up. The fleet's repos used to exist
 * only as an env string parsed into a plain object (`config/fleet.ts`), which
 * meant nothing about a repo could be validated, associated, or shown on a
 * page — the dashboard's spawn `<option>` list was the whole of it. The env
 * variable stays as the BOOTSTRAP source (`importFleetRepos` below); the rows
 * are what the application reads.
 *
 * `checkout_path` is the local checkout, as `FLEET_REPO_PATHS` pairs it: ringo
 * spawns there.
 */
export class Repository extends Hub {
  // trails-tsc types the `hasOne` reader but not its builder.
  // Story: trails-tsc-synthesize-singular-association-builders.
  declare buildSettings: (attributes?: Record<string, unknown>) => RepositorySetting;

  static {
    this.belongsTo("owner");
    // `dependent` for the same reason as Owner's: real FKs mean a destroy
    // without it raises instead of cascading.
    // The repo's feature switches. Named `settings`, never `setting`: trails
    // answers the writer `setting=` with a `setSetting` method when one exists,
    // and an association accessor one letter away from an attribute writer is
    // the trap CLAUDE.md's `set<Attribute>` rule is about.
    this.hasOne("settings", {
      className: "RepositorySetting",
      dependent: "destroy",
    });
    // Who may push here: the composite-key join, see RepositoryCollaborator.
    this.hasMany("collaborators", {
      className: "RepositoryCollaborator",
      inverseOf: "repository",
      dependent: "deleteAll",
    });

    // Identity-mapped, as every other enum here is, and PREFIXED: without
    // `prefix` the generated statics are `Repository.public()` and
    // `.private()`, and trails refuses the enum outright because `public` is
    // already a class method of its own. `visibilityPublic` is Rails'
    // `visibility_public` in this codebase's camelCase.
    this.enum("visibility", { public: "public", private: "private" }, { prefix: true });

    this.validates("name", {
      presence: true,
      // GLOBAL, not scoped to the owner. `app/models/concerns/repo-scope.ts`
      // maps a story to a repository through `stories.pr`, which is `repo#N`
      // with no owner in it — so a second `trails` under another owner would
      // silently inherit this one's 9,000 stories. Until that column is
      // qualified (the tasks CLI's migration, not a page's), the scope needs
      // the name to be unique on its own. `index_repositories_on_lower_name`
      // is the real constraint — this validation only turns the violation
      // into an error on the record instead of a 500.
      uniqueness: { caseSensitive: false },
      format: { with: /^[a-zA-Z0-9](?:[a-zA-Z0-9._-])*$/ },
      length: { maximum: 100 },
    });
    this.validates("default_branch", { presence: true });
  }

  /**
   * `owner/repo`, the way every other system here spells a repo:
   * `FLEET_REPO_PATHS`, ringo's spawn keys, and GitHub's own URLs.
   */
  async nameWithOwner(): Promise<string> {
    return `${(await this.owner)?.login ?? String(this.owner_id)}/${this.name}`;
  }

  /**
   * Whether `viewer` may see this repository at all — THE visibility rule,
   * and the only copy of it: `RepoController` asks before serving any tab and
   * `OwnersController` before listing a row.
   *
   * A public repository is everyone's, a `null` viewer included. A private one
   * is readable by its owner and by anyone with a `repository_collaborators`
   * row for it, whatever the role: `read` is the least a row can say. The
   * role is not consulted, so a public repository costs no query.
   */
  async isReadableBy(viewer: Owner | null): Promise<boolean> {
    if (this.isVisibilityPublic()) return true;
    if (viewer === null) return false;
    if (viewer.id === this.owner_id) return true;
    return RepositoryCollaborator.isExists({ repository_id: this.id, owner_id: viewer.id });
  }

  /**
   * Whether `viewer` may change this repository's settings: its owner, or a
   * collaborator whose role is `admin` — GitHub's rule for the Settings tab.
   * Readability is not enough; a public repository is readable by anyone.
   */
  async isAdministrableBy(viewer: Owner | null): Promise<boolean> {
    if (viewer === null) return false;
    if (viewer.id === this.owner_id) return true;
    return RepositoryCollaborator.isExists({
      repository_id: this.id,
      owner_id: viewer.id,
      role: "admin",
    });
  }

  /**
   * The repository `/:owner/:repo` names, with its owner and settings loaded,
   * because every tab needs all three.
   *
   * THREE queries: the owner, the repository, and `includes("settings")`
   * preloading the settings row. The owner is looked up first so the lookup
   * can stop there when the login is unknown, and so the row it returns can be
   * assigned to `repo.owner` rather than fetched a fourth time by
   * `includes("owner")`.
   *
   * A single joined query would be one round trip, but `lower(login)` and
   * `lower(name)` are indexed separately
   * (`index_owners_on_lower_login`, `index_repositories_on_lower_name`), so
   * each of these is an index lookup and the join would save round trips
   * rather than work.
   *
   * Both comparisons go through Arel — `arelTable.get("name").lower().eq(…)`,
   * Rails' own spelling — so the SQL is `LOWER("repositories"."name") = …`
   * and matches `index_repositories_on_lower_name`. See `Owner.findByLogin`.
   *
   * "nwo" is GitHub's own abbreviation for name-with-owner.
   */
  static async findByNwo(login: string, name: string): Promise<Repository | null> {
    const owner = await Owner.findByLogin(login);
    if (!owner) return null;
    const lowered = Repository.arelTable.get("name").lower().eq(name.toLowerCase());
    const repo = await Repository.where({ owner_id: owner.id })
      .where(lowered)
      .includes("settings")
      .first();
    if (!repo) return null;
    // `includes("owner")` would re-query the row we already hold.
    repo.owner = owner;
    return repo;
  }

  /**
   * The repos the dashboard's spawn control offers: the ROWS, falling back to
   * `FLEET_REPO_PATHS` when the hub holds none.
   *
   * One resolver, as `Setting.ringoBase()` is for ringo's origin. Without it
   * `importFleetRepos` wrote a second copy of the environment that nothing
   * read, which is exactly the two-sources-that-can-disagree shape this
   * application argues against elsewhere.
   *
   * The fallback is what keeps a box with only the variable working, and it is
   * the same ordering: a row overrides, the environment is the floor.
   *
   * MERGED BY NAME, not all-or-nothing. A row wins over the environment entry
   * of the same `owner/repo`, and an entry with no row is still offered. The
   * first version returned the rows whenever there were any, which meant
   * adding a repository to `FLEET_REPO_PATHS` did nothing until someone
   * reseeded — the same two-sources-disagree failure this change exists to
   * remove, pointing the other way.
   *
   * ALPHABETICAL BY NAME, deliberately, and that is the STATUS QUO rather
   * than a change: `fleetRepos()` has sorted its entries since before this
   * branch (config/fleet.ts, the `sort` at the end), so `FLEET_REPO_PATHS` has
   * never decided the order an operator sees. The dashboard renders these as
   * `<option>`s and the browser selects the first, so the head of the list is
   * the default spawn target — on an env-only box it is the same repository
   * after this change as before it, which is the property worth keeping.
   *
   * Were it ever to become meaningful, the fix belongs in `fleetRepos()`,
   * where the environment's order still exists to preserve; by the time it
   * reaches here it has already been sorted away.
   *
   * The empty-hub case falls out of the merge rather than being a special
   * case: no rows, so every entry comes from the environment.
   *
   * `checkoutsOrNone` swallows `ConnectionNotDefined` FOR THE TEST SUITE, the
   * same way and for the same reason as `Setting.findByKey`, whose docblock
   * carries the argument. A deployed process cannot be in that state: it
   * refuses to boot without `HUB_DATABASE_URL`.
   */
  static async spawnChoices(): Promise<FleetRepo[]> {
    const byName = new Map<string, FleetRepo>();
    for (const entry of fleetRepos()) byName.set(entry.name, entry);
    for (const row of await Repository.checkoutsOrNone()) byName.set(row.name, row);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The rows with a checkout, or none at all when there is no hub to ask. */
  private static async checkoutsOrNone(): Promise<FleetRepo[]> {
    try {
      const rows = await Repository.where({ archived: false })
        .where("checkout_path IS NOT NULL")
        .includes("owner")
        .toArray();
      const checkouts = await Promise.all(
        rows
          .filter((repo) => repo.checkout_path)
          .map(async (repo) => ({
            name: await repo.nameWithOwner(),
            path: repo.checkout_path as string,
          })),
      );
      return checkouts.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if (error instanceof ConnectionNotDefined) return [];
      throw error;
    }
  }

  /**
   * Create the rows `FLEET_REPO_PATHS` describes, and update the checkout path
   * of the ones already there.
   *
   * Idempotent, and it never deletes: the env variable lists the repos the
   * dashboard's spawn control offers on ONE box, which is a subset of the
   * repos the hub knows about, so treating its absence as a delete would drop
   * a repo's rows because a deploy forgot a variable.
   *
   * Returns the repositories it touched, so a caller (`db/seeds.ts`) can say
   * what it did.
   */
  static async importFleetRepos(): Promise<Repository[]> {
    const touched: Repository[] = [];
    for (const entry of fleetRepos()) {
      const [login, name] = splitNwo(entry.name);
      if (!login || !name) continue;

      // BANG forms throughout. `create` and `update` answer an UNSAVED record
      // when a validation fails (persistence.ts, as Rails' `create` does at
      // persistence.rb:33 against `create!` at :50), so the non-bang forms
      // turn a malformed `FLEET_REPO_PATHS` entry into a cascade of silent
      // failures: `owner.id` is undefined, the repository fails on it, its
      // settings row fails, and the unsaved repository is still pushed to
      // `touched` and counted in what the seeds print. A bad variable should
      // say so, loudly, once.
      const owner =
        (await Owner.findByLogin(login)) ??
        (await Owner.createBang({ login, kind: "organization" }));
      const existing = await Repository.findByNwo(login, name);
      if (existing) {
        await existing.updateBang({ checkout_path: entry.path });
        touched.push(existing);
        continue;
      }
      const repo = await Repository.createBang({
        owner_id: owner.id,
        name,
        checkout_path: entry.path,
      });
      await RepositorySetting.createBang({ repository_id: repo.id });
      touched.push(repo);
    }
    return touched;
  }
}

/** `owner/repo` → `[owner, repo]`, and `["", ""]` for anything else. */
function splitNwo(nwo: string): [string, string] {
  const at = nwo.indexOf("/");
  if (at < 0) return ["", ""];
  return [nwo.slice(0, at).trim(), nwo.slice(at + 1).trim()];
}
