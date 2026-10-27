import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "./schema.ts";
// Deliberately the model MODULE, not `app/models/index.js`. This file must
// never import the barrel — vitest isolates it in its own worker, and that
// isolation is what makes the assertion below meaningful: `registerModel` is
// process-global, so one barrel import anywhere in this file would arm
// association resolution and the test would pass for the wrong reason.
import { Story } from "../../app/models/story.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  (await Base.leaseConnection()).execute(
    "INSERT INTO stories (id, rfc_id, status, created_at, updated_at)" +
      " VALUES ('dependent', '0061-ci-failures', 'ready', '2026-08-25', '2026-08-25')",
  );
  (await Base.leaseConnection()).execute(
    "INSERT INTO story_deps (story_id, depends_on_id) VALUES ('dependent', 'base')",
  );
});

describe("models without the barrel", () => {
  it("still reads plain columns", async () => {
    const s = await Story.findBy({ id: "dependent" });
    expect(s!.rfc_id).toBe("0061-ci-failures");
    expect(s!.status).toBe("ready");
  });

  it("fails loudly when an association is traversed", async () => {
    const s = await Story.findBy({ id: "dependent" });
    // Not "returns nothing": a silent empty result would look like a story
    // with no deps, and the ready queue would hand it out as unblocked.
    // Throws where the association is BUILT, not where the promise settles.
    expect(() => s!.deps).toThrow(/Missing model class StoryDep/);
  });
});
