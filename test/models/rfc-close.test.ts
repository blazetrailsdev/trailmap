import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { closeRfcIfComplete } from "../../app/models/rfc-close.js";

// The barrel arms the callback at import, so every save below goes through it.
// Silence the rule's report; the assertions read the rows, not stdout.
vi.spyOn(console, "log").mockImplementation(() => {});

beforeEach(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

/**
 * Build the fixture WITHOUT arming the rule under test.
 *
 * Creating a `done` story goes through a save, and the save is exactly what
 * fires the auto-close — so seeding terminal stories one at a time closes the
 * RFC before the assertion runs. `updateAll` skips callbacks (the same
 * property that makes it the wrong tool for the real mutation verbs), which is
 * what lets a fixture state be set up rather than reached.
 */
async function seedRfc(id: string, statuses: string[]): Promise<void> {
  await Rfc.create({ id, status: "active", title: id });
  for (const [i, status] of statuses.entries()) {
    await Story.create({ id: `${id}-${i}`, rfc_id: id, status: "draft" });
    await Story.where({ id: `${id}-${i}` }).updateAll({ status });
  }
}

describe("closeRfcIfComplete", () => {
  it("closes an RFC whose every story is terminal", async () => {
    await seedRfc("0136-trailmap", ["done", "closed"]);

    expect(await closeRfcIfComplete("0136-trailmap")).toBe(true);
    expect((await Rfc.findBy({ id: "0136-trailmap" }))!.status).toBe("closed");
  });

  it("records the close as an event", async () => {
    await seedRfc("0136-trailmap", ["done"]);
    await closeRfcIfComplete("0136-trailmap");

    const events = await Event.where({ verb: "rfc-close" }).toArray();
    expect(events.map((e) => e.rfc_id)).toEqual(["0136-trailmap"]);
    expect(events[0].actor).toBe("auto");
    expect(JSON.parse(events[0].detail!)).toEqual({
      reason: "all stories done or closed",
      stories: 1,
    });
  });

  it("leaves an RFC with an open story alone", async () => {
    await seedRfc("0136-trailmap", ["done", "ready"]);

    expect(await closeRfcIfComplete("0136-trailmap")).toBe(false);
    expect((await Rfc.findBy({ id: "0136-trailmap" }))!.status).toBe("active");
  });

  it("leaves an RFC with no stories alone", async () => {
    // A freshly written RFC whose backlog has not been authored yet — not a
    // finished one.
    await seedRfc("0136-trailmap", []);

    expect(await closeRfcIfComplete("0136-trailmap")).toBe(false);
    expect((await Rfc.findBy({ id: "0136-trailmap" }))!.status).toBe("active");
  });

  it("never closes the CI-failures RFC", async () => {
    // btwhooks files a fresh story under it every time main goes red, so it
    // has to stay active even with an all-terminal backlog.
    await seedRfc("0061-ci-failures", ["done", "done"]);

    expect(await closeRfcIfComplete("0061-ci-failures")).toBe(false);
    expect((await Rfc.findBy({ id: "0061-ci-failures" }))!.status).toBe("active");
  });

  it("ignores an unknown, already-closed, or missing rfc id", async () => {
    await Rfc.create({ id: "0002-draft-rfc", status: "closed", title: "Draft" });
    await Story.create({ id: "s", rfc_id: "0002-draft-rfc", status: "done" });

    expect(await closeRfcIfComplete(null)).toBe(false);
    expect(await closeRfcIfComplete("no-such-rfc")).toBe(false);
    expect(await closeRfcIfComplete("0002-draft-rfc")).toBe(false);
  });
});

describe("registerRfcAutoClose", () => {
  it("closes the RFC when its last story lands, without the verb asking", async () => {
    await seedRfc("0136-trailmap", ["ready"]);
    const story = await Story.findBy({ id: "0136-trailmap-0" });

    story!.status = "done";
    await story!.save();

    expect((await Rfc.findBy({ id: "0136-trailmap" }))!.status).toBe("closed");
  });

  it("does not fire while a story moves between non-terminal states", async () => {
    await seedRfc("0136-trailmap", ["ready", "ready"]);
    const story = await Story.findBy({ id: "0136-trailmap-0" });

    story!.status = "in-progress";
    await story!.save();

    expect((await Rfc.findBy({ id: "0136-trailmap" }))!.status).toBe("active");
    expect(await Event.where({ verb: "rfc-close" }).count()).toBe(0);
  });
});
