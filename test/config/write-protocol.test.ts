import { describe, expect, it } from "vitest";
import { getFsAsync } from "@blazetrails/activesupport";
import { env, setEnv } from "@blazetrails/activesupport/process-adapter";
import { tasksDatabaseConfig } from "../../config/database.js";
import { ringoDsnPragmas, tableOwners, tablesOwnedBy, writeProtocol } from "../../config/write-protocol.js";
import * as models from "../../app/models/index.js";

/**
 * The write protocol, enforced rather than promised: every table has exactly
 * one owner, trailmap's models only map trailmap-owned tables, and ringo's
 * vendored Go writes nothing it does not own. See docs/write-protocol.md.
 */
const ROOT = new URL("../..", import.meta.url).pathname;
const WRITE = /\b(?:(?:insert|replace)\s+(?:or\s+\w+\s+)?into|delete\s+from)\s+["`]?(\w+)|\bupdate\s+["`]?(\w+)["`]?\s+set\b/gi;

async function read(path: string): Promise<string> {
  const fs = await getFsAsync();
  return String(await fs.readFile!(`${ROOT}${path}`, "utf8"));
}

async function goSources(dir: string): Promise<string[]> {
  const fs = await getFsAsync();
  const out: string[] = [];
  for (const name of await fs.readdir!(`${ROOT}${dir}`)) {
    const path = `${dir}/${name}`;
    if ((await fs.stat!(`${ROOT}${path}`)).isDirectory()) out.push(...(await goSources(path)));
    else if (name.endsWith(".go")) out.push(path);
  }
  return out;
}

describe("write protocol", () => {
  it("names an owner for every table in the schema", async () => {
    const schema = await read("db/schema.ts");
    const tables = [...schema.matchAll(/createTable\("(\w+)"/g)].map((m) => m[1]).sort();
    expect(Object.keys(tableOwners).sort()).toEqual(tables);
  });

  it("maps trailmap's models only onto trailmap-owned tables", () => {
    const mapped = Object.values(models)
      .map((model) => (model as { _tableName?: string })._tableName)
      .filter((name): name is string => typeof name === "string");
    expect(mapped.length).toBeGreaterThan(0);
    for (const table of mapped) expect(tableOwners[table], table).toBe("trailmap");
  });

  it("keeps ringo's SQL writes off trailmap-owned tables", async () => {
    const owned = new Set(tablesOwnedBy("trailmap"));
    for (const path of await goSources("vendor/ringo/go")) {
      for (const [, inserted, updated] of (await read(path)).matchAll(WRITE)) {
        const table = inserted ?? updated;
        expect(owned.has(table), `${path} writes trailmap-owned table ${table}`).toBe(false);
      }
    }
  });

  it("opens trailmap's connection with the protocol's busy timeout", () => {
    const database = env.TASKS_DATABASE;
    setEnv("TASKS_DATABASE", database ?? "storage/test.sqlite3");
    try {
      expect(tasksDatabaseConfig()).toMatchObject({ timeout: writeProtocol.busyTimeoutMs });
    } finally {
      setEnv("TASKS_DATABASE", database);
    }
  });

  it("states the same values ringo's DSN carries", async () => {
    expect(ringoDsnPragmas).toBe("_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)");
    expect(await read("docs/write-protocol.md")).toContain(ringoDsnPragmas);
  });
});
