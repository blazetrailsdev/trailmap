import { Hub } from "./hub.ts";
import type { Owner } from "./owner.ts";
import type { Repository } from "./repository.ts";
import type { Relation } from "@blazetrails/activerecord";

export const COLLABORATOR_ROLES = ["read", "write", "admin"] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

/**
 * An owner's access to a repository — GitHub's Collaborators.
 *
 * THE COMPOSITE PRIMARY KEY in this application. `(repository_id, owner_id)`
 * is the identity: an owner is a collaborator on a repository at most once, so
 * the pair says everything a surrogate `id` would, and a surrogate would add a
 * second way to name the same row. Rails has supported composite keys natively
 * since 7.1 and `primaryKey` takes the array directly.
 *
 * What that changes for a caller, and what the tests pin:
 *
 * - `find` takes the pair — `RepositoryCollaborator.find([repoId, ownerId])`.
 * - `primaryKey` answers an ARRAY, so anything that assumes a string (a URL
 *   helper, a serializer) has to be told otherwise.
 * - the database enforces it: Postgres refuses a duplicate pair whether or not
 *   the model validates, which is why there is no uniqueness validation here
 *   pretending to be the guard.
 */
export class RepositoryCollaborator extends Hub {
  declare repository_id: number;
  declare owner_id: number;
  declare role: CollaboratorRole;

  declare repository: Repository | null;
  declare owner: Owner | null;

  declare isRoleRead: () => boolean;
  declare isRoleWrite: () => boolean;
  declare isRoleAdmin: () => boolean;
  declare static roleAdmin: () => Relation<RepositoryCollaborator>;

  static {
    // ASSIGNED through the setter, never `static _primaryKey = [...]`.
    // `_compositePrimaryKey` — the flag every composite-key path in the
    // library is gated on (`findOne`'s zip branch, `findWithIds`'s
    // expectsArray) — is derived INSIDE this setter. A class field writes the
    // backing property directly and skips it, so the key reads as composite
    // while the flag stays false and `find([a, b])` builds a where-clause the
    // predicate builder refuses. Same shape as `abstractClass` in
    // app/models/hub.ts; CLAUDE.md carries the rule.
    //
    // `composite-primary-key-is-included-by-primary-key-setter-only`
    // (trails#8741) addresses the derivation itself, and merged just after the
    // commit this vendors. The static block stays either way: it goes through
    // the setter, which is correct on both sides of that fix.
    this.primaryKey = ["repository_id", "owner_id"];

    this.belongsTo("repository");
    this.belongsTo("owner");

    // Prefixed for the same reason `Repository.visibility` is: an unprefixed
    // `read` would generate a class method named after a word the library may
    // already own, and the prefix makes `roleAdmin` read as what it is.
    this.enum(
      "role",
      { read: "read", write: "write", admin: "admin" },
      { prefix: true },
    );

    this.validates("role", { presence: true });
  }

  /** `write` and `admin` may push; `read` may not. */
  canPush(): boolean {
    return this.role !== "read";
  }
}
