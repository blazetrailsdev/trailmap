import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RecordNotFound } from "@blazetrails/activerecord";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.ts";
import { Owner } from "../../app/models/owner.ts";
import { Repository } from "../../app/models/repository.ts";
import { RepositoryCollaborator } from "../../app/models/repository-collaborator.ts";

/**
 * The composite primary key, `(repository_id, owner_id)`.
 *
 * Everything here is about the pair being the IDENTITY rather than a
 * uniqueness rule bolted onto a surrogate id, because that is where a port's
 * assumptions break: `primaryKey` answers an array, `find` takes a pair, and
 * the database refuses a duplicate whether or not the model agrees.
 */
/**
 * `find` is typed `T | T[]`: an array argument reads as "find these ids" to
 * the overload, which cannot know the model's key is itself an array. For a
 * composite key it is ONE record — Rails' `find_one`, which zips the key names
 * with the values. The cast is that knowledge, in one place.
 */
async function findPair(repositoryId: number, ownerId: number): Promise<RepositoryCollaborator> {
  return (await RepositoryCollaborator.find([repositoryId, ownerId])) as RepositoryCollaborator;
}

describe.skipIf(!hasHubTestDatabase())("RepositoryCollaborator", () => {
  let repo: Repository;
  let member: Owner;

  beforeAll(async () => {
    await connectHubTestDatabase();
  }, HUB_SETUP_TIMEOUT);
  afterAll(releaseHubTestDatabase);

  beforeEach(async () => {
    await truncateHub();
    const org = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
    repo = await Repository.create({ owner_id: org.id, name: "trails" });
    member = await Owner.create({ login: "dean", kind: "user" });
  });

  it("answers an ARRAY for primaryKey, not a string", () => {
    expect(RepositoryCollaborator.primaryKey).toEqual(["repository_id", "owner_id"]);

    // The contrast that makes it worth asserting: its neighbours are scalar.
    expect(Repository.primaryKey).toBe("id");
  });

  it("is found by the pair", async () => {
    await RepositoryCollaborator.create({
      repository_id: repo.id,
      owner_id: member.id,
      role: "write",
    });

    const found = await findPair(repo.id, member.id);

    expect(found.role).toBe("write");
    expect(found.repository_id).toBe(repo.id);
    expect(found.owner_id).toBe(member.id);
  });

  it("raises for a pair that is not there, rather than finding a neighbour", async () => {
    await RepositoryCollaborator.create({ repository_id: repo.id, owner_id: member.id });

    // Same repository, a different owner: half of a real key is not a key.
    const other = await Owner.create({ login: "someone-else", kind: "user" });
    await expect(findPair(repo.id, other.id)).rejects.toBeInstanceOf(RecordNotFound);
  });

  it("lets the DATABASE refuse a duplicate pair", async () => {
    await RepositoryCollaborator.create({ repository_id: repo.id, owner_id: member.id });

    // No uniqueness validation on the model: the composite PRIMARY KEY is the
    // guard, so this is Postgres talking, not ActiveRecord.
    await expect(
      RepositoryCollaborator.create({ repository_id: repo.id, owner_id: member.id }),
    ).rejects.toThrow();
  });

  it("takes the same owner on a different repository", async () => {
    const second = await Repository.create({ owner_id: repo.owner_id, name: "trailmap" });

    await RepositoryCollaborator.create({ repository_id: repo.id, owner_id: member.id });
    await RepositoryCollaborator.create({ repository_id: second.id, owner_id: member.id });

    expect(await RepositoryCollaborator.count()).toBe(2);
  });

  it("traverses both ways through the join", async () => {
    await RepositoryCollaborator.create({
      repository_id: repo.id,
      owner_id: member.id,
      role: "admin",
    });

    const fromRepo = await (await Repository.find(repo.id)).collaborators.toArray();
    expect(fromRepo.map((c) => c.owner_id)).toEqual([member.id]);

    const fromOwner = await (await Owner.find(member.id)).collaborations.toArray();
    expect(fromOwner.map((c) => c.repository_id)).toEqual([repo.id]);
  });

  it("defaults to read, and only write and admin may push", async () => {
    const reader = await RepositoryCollaborator.create({
      repository_id: repo.id,
      owner_id: member.id,
    });
    expect(reader.role).toBe("read");
    expect(reader.canPush()).toBe(false);
    expect(reader.isRoleRead()).toBe(true);

    await reader.update({ role: "admin" });
    expect(reader.canPush()).toBe(true);
    expect((await RepositoryCollaborator.roleAdmin().count())).toBe(1);
  });

  it("updates and destroys by the pair", async () => {
    const row = await RepositoryCollaborator.create({
      repository_id: repo.id,
      owner_id: member.id,
    });

    // An UPDATE and a DELETE both need a WHERE naming both columns; a port
    // that built them from a single `id` would touch no row, or every row.
    await row.update({ role: "write" });
    expect((await findPair(repo.id, member.id)).role).toBe("write");

    await row.destroy();
    expect(await RepositoryCollaborator.count()).toBe(0);
  });
});
