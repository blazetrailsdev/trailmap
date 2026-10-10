import { Hub } from "./hub.js";
import { Owner } from "./owner.js";
import { RepositorySetting } from "./repository-setting.js";
import type { RepositoryCollaborator } from "./repository-collaborator.js";
import { fleetRepos } from "../../config/fleet.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";

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
 */
export class Repository extends Hub {
  static _tableName = "repositories";

  declare id: number;
  declare owner_id: number;
  declare name: string;
  /** The local checkout, as `FLEET_REPO_PATHS` pairs it — ringo spawns there. */
  declare checkout_path: string | null;
  declare default_branch: string;
  declare visibility: RepositoryVisibility;
  declare description: string | null;
  declare archived: boolean;

  declare owner: Owner | null;
  /**
   * The repo's feature switches.
   *
   * Named `settings`, never `setting`: trails answers the writer `setting=`
   * with a `setSetting` method when one exists, and an association accessor
   * one letter away from an attribute writer is the trap CLAUDE.md's
   * `set<Attribute>` rule is about.
   */
  declare settings: RepositorySetting | null;

  /** Who may push here — the composite-key join, see RepositoryCollaborator. */
  declare collaborators: AssociationProxy<RepositoryCollaborator>;

  declare static visibilityPublic: () => Relation<Repository>;
  declare static visibilityPrivate: () => Relation<Repository>;
  declare isVisibilityPublic: () => boolean;
  declare isVisibilityPrivate: () => boolean;

  static {
    this.belongsTo("owner", { className: "Owner", foreignKey: "owner_id" });
    this.hasOne("settings", { className: "RepositorySetting", foreignKey: "repository_id" });
    this.hasMany("collaborators", {
      className: "RepositoryCollaborator",
      foreignKey: "repository_id",
      inverseOf: "repository",
    });

    // Identity-mapped, as every other enum here is, and PREFIXED: without
    // `prefix` the generated statics are `Repository.public()` and
    // `.private()`, and trails refuses the enum outright because `public` is
    // already a class method of its own. `visibilityPublic` is Rails'
    // `visibility_public` in this codebase's camelCase.
    this.enum("visibility", { public: "public", private: "private" }, { prefix: true });

    this.validates("name", {
      presence: true,
      uniqueness: { scope: "owner_id", caseSensitive: false },
      format: { with: /^[a-zA-Z0-9](?:[a-zA-Z0-9._-])*$/ },
      length: { maximum: 100 },
    });
    this.validates("default_branch", { presence: true });
  }

  /**
   * `owner/repo`, the way every other system here spells a repo:
   * `FLEET_REPO_PATHS`, ringo's spawn keys, and GitHub's own URLs.
   */
  nameWithOwner(): string {
    return `${this.owner?.login ?? String(this.owner_id)}/${this.name}`;
  }

  /**
   * The repository `/:owner/:repo` names, with its owner and settings loaded —
   * one round trip, because every tab needs all three.
   *
   * "nwo" is GitHub's own abbreviation for name-with-owner.
   */
  static async findByNwo(login: string, name: string): Promise<Repository | null> {
    const owner = await Owner.findByLogin(login);
    if (!owner) return null;
    const repo = await Repository.where({ owner_id: owner.id })
      .where("lower(name) = ?", name.toLowerCase())
      .includes("settings")
      .first();
    if (!repo) return null;
    // `includes("owner")` would re-query the row we already hold.
    repo.owner = owner;
    return repo;
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

      const owner =
        (await Owner.findByLogin(login)) ??
        (await Owner.create({ login, kind: "organization" }));
      const existing = await Repository.findByNwo(login, name);
      if (existing) {
        await existing.update({ checkout_path: entry.path });
        touched.push(existing);
        continue;
      }
      const repo = await Repository.create({
        owner_id: owner.id,
        name,
        checkout_path: entry.path,
      });
      await RepositorySetting.create({ repository_id: repo.id });
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
