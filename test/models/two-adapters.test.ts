import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "./schema.js";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../support/hub-schema.js";
import { Hub } from "../../app/models/hub.js";
import { Owner } from "../../app/models/owner.js";
import { Repository } from "../../app/models/repository.js";
import { Rfc } from "../../app/models/rfc.js";
import { Story } from "../../app/models/story.js";

/**
 * Two databases, two ADAPTERS, one process — the thing this change is for.
 *
 * The task domain stays on SQLite (`ActiveRecord::Base`, pointed at the CLI's
 * `tasks.db` in a real process) and the owner/repository hierarchy is on
 * Postgres under `Hub`. Every connection trailmap had ever opened before this
 * was sqlite3, so the vendored PostgreSQL adapter had never been driven by an
 * application at all.
 *
 * What this asserts is the part that could silently not be true: that the two
 * pools are separate, that neither model subtree is resolved through the
 * other's connection, and that a query to one does not disturb the other's
 * next query. A single shared pool would pass most of the other tests in this
 * suite and fail here.
 */
describe.skipIf(!hasHubTestDatabase())("two adapters in one process", () => {
  beforeAll(async () => {
    await migrateScratchDatabase();
    await connectHubTestDatabase();
    await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });
    await Story.create({ id: "a-story", rfc_id: "0136-trailmap", status: "ready" });
    const owner = await Owner.create({ login: "blazetrailsdev", kind: "organization" });
    await Repository.create({ owner_id: owner.id, name: "trails" });
  }, HUB_SETUP_TIMEOUT);
  // Hands the hub to the next test file; see `releaseHubTestDatabase`.
  afterAll(releaseHubTestDatabase);

  it("gives the two subtrees different pools", () => {
    expect(Base.connectionPool()).not.toBe(Hub.connectionPool());
    expect(Story.connectionPool()).toBe(Base.connectionPool());
    expect(Owner.connectionPool()).toBe(Hub.connectionPool());
    expect(Repository.connectionPool()).toBe(Hub.connectionPool());
  });

  it("runs each subtree on its own adapter", () => {
    expect(Base.connectionPool().dbConfig.adapter).toBe("sqlite3");
    expect(Hub.connectionPool().dbConfig.adapter).toBe("postgresql");
  });

  it("reads from both, interleaved, without either losing its connection", async () => {
    // Interleaved on purpose: a shared pool, or a specification name resolved
    // up to `Base`, shows up as the second read finding the first database's
    // tables — "no such table: owners", or a Postgres error about `stories`.
    expect((await Story.findBy({ id: "a-story" }))?.rfc_id).toBe("0136-trailmap");
    expect((await Owner.findByLogin("blazetrailsdev"))?.kind).toBe("organization");
    expect(await Story.count()).toBe(1);
    expect(await Repository.count()).toBe(1);
    expect((await Rfc.findBy({ id: "0136-trailmap" }))?.status).toBe("active");
    expect((await Repository.findByNwo("blazetrailsdev", "trails"))?.name).toBe("trails");
  });

  it("keeps the task tables out of the hub database and the hub tables out of the task one", async () => {
    const taskTables = new Set(await Base.connectionPool().withConnection((c) => c.tables()));
    const hubTables = new Set(await Hub.connectionPool().withConnection((c) => c.tables()));

    // The one that caught a real defect: `trails db migrate --database hub`
    // treats the targeted database as primary and loads `db/schema.ts` into
    // it, which puts `stories` and `rfcs` in Postgres. See tmp notes / the
    // trails story; the fix is to migrate with no `--database` flag.
    expect(hubTables.has("stories")).toBe(false);
    expect(hubTables.has("rfcs")).toBe(false);
    expect(taskTables.has("owners")).toBe(false);
    expect(taskTables.has("repositories")).toBe(false);
  });
});
