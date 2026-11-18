import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { isStale } from "./support/build-views.ts";
import { workerDatabaseUrl } from "./support/hub-schema.ts";

describe("workerDatabaseUrl", () => {
  it("names the worker's own copy, keeping the credentials and query", () => {
    expect(workerDatabaseUrl("postgres://u:p@10.0.0.1:5432/trailmap_hub_test?sslmode=disable", 3)).toBe(
      "postgres://u:p@10.0.0.1:5432/trailmap_hub_test-3?sslmode=disable",
    );
  });
});

describe("isStale", () => {
  it("is stale when a template has no output or a newer mtime, and fresh otherwise", async () => {
    const fs = getFs();
    const root = fs.mkdtempSync!("/tmp/trailmap-views-");
    fs.mkdirSync(`${root}/src/a`, { recursive: true });
    fs.mkdirSync(`${root}/out/a`, { recursive: true });
    fs.writeFileSync(`${root}/src/a/x.html.tse`, "x");
    try {
      expect(await isStale(`${root}/src`, `${root}/out`)).toBe(true);
      fs.writeFileSync(`${root}/out/a/x.html.tse.js`, "x");
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync!(`${root}/src/a/x.html.tse`, old, old);
      expect(await isStale(`${root}/src`, `${root}/out`)).toBe(false);
      fs.utimesSync!(`${root}/out/a/x.html.tse.js`, new Date(old.getTime() - 60_000), new Date(old.getTime() - 60_000));
      expect(await isStale(`${root}/src`, `${root}/out`)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
