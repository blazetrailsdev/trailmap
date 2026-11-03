import { describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { getFs } from "@blazetrails/ruby-compat";
import { ALL_MODELS, loadModelSchemas } from "../../lib/model-schemas.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { Story } from "../../app/models/story.ts";
import { migrateScratchDatabase } from "../models/schema.ts";

describe("the schema warm-up lists", () => {
  // Compared with lib/model-schemas' own lists, not the constant registry: the
  // autoloader seats a class however it was loaded, so the registry cannot see a
  // model left out, and that model's schema is never warmed. Covers every concrete
  // Base subclass any file exports, at any depth of inheritance.
  it("lists every model in app/models", async () => {
    const listed = new Set(ALL_MODELS.map((model) => model.name));
    const seen: string[] = [];
    const missing: string[] = [];
    for (const file of await getFs().readdir!("app/models")) {
      if (!String(file).endsWith(".ts")) continue;
      const exported = (await import(`../../app/models/${file}`)) as Record<string, unknown>;
      for (const value of Object.values(exported)) {
        if (typeof value !== "function" || !(value.prototype instanceof Base)) continue;
        if ((value as unknown as typeof Base).abstractClass) continue;
        seen.push(value.name);
        if (!listed.has(value.name)) missing.push(value.name);
      }
    }
    expect(seen).toContain("Story");
    expect(seen).toContain("ApiCompareStat");
    expect(missing).toEqual([]);
  });
});

describe("the suite boots the application", () => {
  it("requires belongs_to by default", async () => {
    await migrateScratchDatabase();
    await loadModelSchemas();
    const story = new Story({ id: "orphan", rfc_id: "0000-none", status: "draft" });
    expect(await story.save()).toBe(false);
    await Rfc.create({ id: "0000-none", status: "active", title: "T" });
    expect(await new Story({ id: "kept", rfc_id: "0000-none", status: "draft" }).save()).toBe(true);
  });
});
