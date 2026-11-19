/**
 * The hub migration that moves the refine reports onto Base: `up` then `down`
 * over a seeded `rfc_refines` row gives the row back as it was.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hub } from "../../app/models/hub.ts";
import { Refinement } from "../../app/models/refinement.ts";
import { CreateRfcRefines } from "../../db/hub-migrate/20261117000007_create_rfc_refines.ts";
import { MoveRfcRefinesToRefinements } from "../../db/hub-migrate/20261119000008_move_rfc_refines_to_refinements.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
} from "../support/hub-schema.ts";

const COLUMNS = "rfc_id, outcome, summary, created_at, updated_at";

describe.skipIf(!hasHubTestDatabase())("MoveRfcRefinesToRefinements", () => {
  beforeAll(connectHubTestDatabase, HUB_SETUP_TIMEOUT);
  afterAll(releaseHubTestDatabase);

  it("moves every report onto Base with its summary attached, and back", async () => {
    await Hub.connectionPool().withConnection(async (connection) => {
      const create = new CreateRfcRefines();
      const move = new MoveRfcRefinesToRefinements();
      create.connection = move.connection = connection;
      try {
        await create.change();
        await connection.execute(
          `INSERT INTO rfc_refines (${COLUMNS}) VALUES ` +
            "('0136-trailmap', 'changed', '# Report\n\nclosed **3**', '2026-11-01 09:00:00.123456', '2026-11-01 09:30:00')",
        );
        const before = (await connection.selectAll(`SELECT ${COLUMNS} FROM rfc_refines`)).toArray();

        await move.up();

        expect(await connection.tableExists("rfc_refines")).toBe(false);
        const [moved, ...rest] = await Refinement.all().toArray();
        expect(rest).toEqual([]);
        expect([moved!.rfc_id, moved!.outcome, moved!.stories]).toEqual(["0136-trailmap", "changed", null]);
        expect(moved!.created_at.utc().iso8601(6)).toBe("2026-11-01T09:00:00.123456Z");
        const blob = (await (await moved!.summary.attachment)!.blob)!;
        expect(blob.content_type).toBe("text/markdown");
        expect(new TextDecoder().decode(await blob.download())).toBe("# Report\n\nclosed **3**");

        await move.down();

        expect(await Refinement.count()).toBe(0);
        expect((await connection.selectAll(`SELECT ${COLUMNS} FROM rfc_refines`)).toArray()).toEqual(before);
      } finally {
        await connection.execute("DROP TABLE IF EXISTS rfc_refines");
      }
    });
  });

  it("leaves Base untouched when there are no reports", async () => {
    await Hub.connectionPool().withConnection(async (connection) => {
      const create = new CreateRfcRefines();
      const move = new MoveRfcRefinesToRefinements();
      create.connection = move.connection = connection;
      try {
        await create.change();
        await move.up();
        expect(await Refinement.count()).toBe(0);
        expect(await connection.tableExists("rfc_refines")).toBe(false);
      } finally {
        await connection.execute("DROP TABLE IF EXISTS rfc_refines");
      }
    });
  });
});
