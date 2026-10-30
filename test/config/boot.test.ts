import { describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { getFs, isRegisteredConstant } from "@blazetrails/ruby-compat";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { migrateScratchDatabase } from "../models/schema.ts";

describe("the model barrel", () => {
  // The boot loads the barrel, so a model left out of it would only surface in
  // a process that traverses an association without it. Every concrete Base
  // subclass any file exports, at any depth of inheritance, must be registered.
  it("registers every model in app/models", async () => {
    const seen: string[] = [];
    const missing: string[] = [];
    for (const file of await getFs().readdir!("app/models")) {
      if (!String(file).endsWith(".ts")) continue;
      const exported = (await import(`../../app/models/${file}`)) as Record<string, unknown>;
      for (const value of Object.values(exported)) {
        if (typeof value !== "function" || !(value.prototype instanceof Base)) continue;
        if ((value as unknown as typeof Base).abstractClass) continue;
        seen.push(value.name);
        if (!isRegisteredConstant(value.name)) missing.push(value.name);
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
