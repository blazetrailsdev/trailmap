import { Hub } from "./hub.js";
import type { AssociationProxy, Relation } from "@blazetrails/activerecord";
import type { Repository } from "./repository.js";
import type { RepositoryCollaborator } from "./repository-collaborator.js";

export const OWNER_KINDS = ["user", "organization"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

/**
 * A user or an organization — the root of the URL space, as on GitHub:
 * `/blazetrailsdev` is this record and `/blazetrailsdev/trails` one of its
 * repositories.
 *
 * `login` is the path segment and the natural key, but it is NOT the primary
 * key: a login can be renamed (GitHub renames them, and the fleet's repos are
 * named after a real account), and renaming a primary key rewrites every
 * foreign key that points at it. The surrogate `id` Postgres hands out absorbs
 * that; the uniqueness index on `login` is what keeps it a key.
 */
export class Owner extends Hub {
  static _tableName = "owners";

  declare id: number;
  declare login: string;
  declare kind: OwnerKind;
  declare display_name: string | null;
  declare description: string | null;

  declare repositories: AssociationProxy<Repository>;
  /** Repositories this owner collaborates on, via the composite-key join. */
  declare collaborations: AssociationProxy<RepositoryCollaborator>;

  declare isUser: () => boolean;
  declare isOrganization: () => boolean;
  declare static user: () => Relation<Owner>;
  declare static organization: () => Relation<Owner>;

  static {
    this.hasMany("repositories", { foreignKey: "owner_id", inverseOf: "owner" });
    this.hasMany("collaborations", {
      className: "RepositoryCollaborator",
      foreignKey: "owner_id",
      inverseOf: "owner",
    });

    // Identity-mapped, for the reason Story.status is: a label that differs
    // from the stored value makes `owner.kind` and `SELECT kind` disagree, and
    // which of the two a code path happens to read decides what it writes.
    this.enum("kind", { user: "user", organization: "organization" });

    this.validates("login", {
      presence: true,
      uniqueness: { caseSensitive: false },
      // GitHub's own rule: alphanumerics and single hyphens, no leading or
      // trailing hyphen. It is also what keeps a login out of the router's
      // reserved space — see RESERVED_OWNER_NAMES in config/routes.ts.
      format: { with: /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/ },
      length: { maximum: 39 },
    });
    this.validates("kind", { presence: true });
  }

  /**
   * The owner whose `login` is `login`, case-insensitively — `/BlazeTrailsDev`
   * resolves to `blazetrailsdev` as it does on GitHub, which is also what the
   * uniqueness validation above promises.
   */
  static async findByLogin(login: string): Promise<Owner | null> {
    return (await Owner.where("lower(login) = ?", login.toLowerCase()).first()) ?? null;
  }

  /** What the page shows: the display name when there is one, else the login. */
  title(): string {
    return this.display_name ?? this.login;
  }
}
