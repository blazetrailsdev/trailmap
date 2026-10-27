/**
 * No model method is named `set<Attribute>`.
 *
 * trails answers the writer `priority=` with a `setPriority` method when one
 * exists. A verb by that name therefore becomes the attribute's setter: every
 * `new`, `create` and `update` that passes `priority` runs it, and a verb that
 * updates runs itself again. `Story#setPriority` did exactly that from trails
 * `5ee5760880` on, and took every test that built a story with a priority down
 * with an out-of-memory crash rather than a failure.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "./schema.ts";
import { Event, Meta, Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

describe("model method names", () => {
  it.each([Event, Meta, Rfc, Story].map((model) => [model.name, model] as const))(
    "%s defines no set<Attribute> method",
    (_name, model) => {
      const columns = new Set(model.columnNames().map((column: string) => column.replace(/_/g, "")));
      const colliding = Object.getOwnPropertyNames(model.prototype).filter((name) => {
        const match = /^set([A-Z]\w*)$/.exec(name);
        return match !== null && columns.has(match[1].toLowerCase());
      });

      expect(colliding).toEqual([]);
    },
  );
});
