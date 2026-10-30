import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { migrateScratchDatabase } from "../models/schema.ts";

describe("the model barrel", () => {
  // The boot loads the barrel, so a model left out of it would only surface in
  // a process that traverses an association without it.
  it("registers every model in app/models", async () => {
    const barrel = await getFs().readFile!("app/models/index.ts", "utf8");
    const missing: string[] = [];
    for (const file of await getFs().readdir!("app/models")) {
      if (!String(file).endsWith(".ts") || file === "index.ts") continue;
      const source = await getFs().readFile!(`app/models/${file}`, "utf8");
      for (const [, name] of source.matchAll(/^export class (\w+) extends (?:ApplicationRecord|Hub|Stats)\b/gm)) {
        if (!new RegExp(`\\b${name}\\b`).test(barrel)) missing.push(name!);
      }
    }
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
