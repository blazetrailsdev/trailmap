/**
 * The hub migration that drops `rfc_refines`: an empty table goes, a table with
 * rows refuses (it cannot move them; Base is the hub while it runs), and
 * `down` gives the table back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hub } from "../../app/models/hub.ts";
import { CreateRfcRefines } from "../../db/hub-migrate/20261117000007_create_rfc_refines.ts";
import { MoveRfcRefinesToRefinements } from "../../db/hub-migrate/20261119000008_move_rfc_refines_to_refinements.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../support/hub-schema.ts";

describe.skipIf(!hasHubTestDatabase())("MoveRfcRefinesToRefinements", () => {
  beforeAll(connectHubTestDatabase, HUB_SETUP_TIMEOUT);
  afterAll(releaseHubTestDatabase);

  async function withMigrations(fn: (c: Awaited<MoveRfcRefinesToRefinements["connection"]>, move: MoveRfcRefinesToRefinements) => Promise<void>) {
    await Hub.connectionPool().withConnection(async (connection) => {
      const create = new CreateRfcRefines();
      const move = new MoveRfcRefinesToRefinements();
      create.connection = move.connection = connection;
      try {
        await create.change();
        await fn(connection, move);
      } finally {
        await connection.execute("DROP TABLE IF EXISTS rfc_refines");
      }
    });
  }

  it("drops an empty table, and down recreates it", async () => {
    await withMigrations(async (connection, move) => {
      await move.up();
      expect(await connection.tableExists("rfc_refines")).toBe(false);
      await move.down();
      expect(await connection.tableExists("rfc_refines")).toBe(true);
    });
  });

  it("refuses to drop a table that holds reports", async () => {
    await withMigrations(async (connection, move) => {
      await connection.execute(
        "INSERT INTO rfc_refines (rfc_id, outcome, summary, created_at, updated_at) " +
          "VALUES ('0136-trailmap', 'changed', 'x', '2026-11-01 09:00:00', '2026-11-01 09:00:00')",
      );
      await expect(move.up()).rejects.toThrow(/holds 1 row/);
      expect(await connection.tableExists("rfc_refines")).toBe(true);
    });
  });
});
