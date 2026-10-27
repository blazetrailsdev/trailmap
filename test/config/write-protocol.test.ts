import { describe, expect, it } from "vitest";
import { env, getFs, setEnv } from "@blazetrails/ruby-compat";
import { tasksDatabaseConfig } from "../../config/database.ts";
import { ringoBusyTimeoutPragma, tableOwners, tablesOwnedBy, writeProtocol } from "../../config/write-protocol.ts";
import * as models from "../../app/models/index.ts";
import { Hub } from "../../app/models/hub.ts";
import { Stats } from "../../app/models/stats.ts";

/**
 * The write protocol, enforced rather than promised: every table has exactly
 * one owner, trailmap's models only map trailmap-owned tables, and ringo's
 * database code — every file with a `sql.Open`, vendored whole by
 * scripts/vendor-ringo.sh — opens the file as the protocol says and writes
 * nothing it does not own. See docs/write-protocol.md.
 */
const ROOT = new URL("../..", import.meta.url).pathname;
const WRITE = /\b(?:(?:insert|replace)\s+(?:or\s+\w+\s+)?into|delete\s+from)\s+["`]?(\w+)|\bupdate\s+["`]?(\w+)["`]?\s+set\b/gi;

async function read(path: string): Promise<string> {
  const fs = getFs();
  return String(await fs.readFile!(`${ROOT}${path}`, "utf8"));
}

async function goSources(dir: string): Promise<string[]> {
  const fs = getFs();
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
    // The models on the SHARED SQLITE FILE only, which is what `tableOwners`
    // lists the tables of (`db/schema.ts`). Two subtrees are not on it and the
    // one-writer-per-table protocol has nothing to say about either:
    //
    // - `Hub` (app/models/hub.ts) is a Postgres database that ringo has no
    //   handle on and no migrations for.
    // - `Stats` (app/models/stats.ts) is the stats database the nightly sync
    //   cron owns. trailmap's connection to it is READ-ONLY at the driver, so
    //   it cannot be a second writer to anything even in principle.
    const excluded = [Hub, Stats];
    const mapped = Object.values(models)
      .filter(
        (model) =>
          typeof model === "function" &&
          !excluded.some((base) => model === base || model.prototype instanceof base),
      )
      .map((model) => (model as { tableName?: string | null }).tableName)
      .filter((name): name is string => typeof name === "string");
    expect(mapped.length).toBeGreaterThan(0);
    for (const table of mapped) expect(tableOwners[table], table).toBe("trailmap");
  });

  it("keeps ringo's SQL writes off trailmap-owned tables", async () => {
    const owned = new Set(tablesOwnedBy("trailmap"));
    const sources = await goSources("vendor/ringo/db");
    expect(sources.length).toBeGreaterThan(0);
    for (const path of sources) {
      for (const [, inserted, updated] of (await read(path)).matchAll(WRITE)) {
        const table = inserted ?? updated;
        expect(owned.has(table), `${path} writes trailmap-owned table ${table}`).toBe(false);
      }
    }
  });

  it("opens every ringo handle with the protocol's busy timeout, read-only unless it owns a table", async () => {
    const opens: string[] = [];
    let calls = 0;
    for (const path of await goSources("vendor/ringo/db")) {
      const source = await read(path);
      calls += source.match(/\bsql\.Open\s*\(/g)?.length ?? 0;
      for (const [, dsn] of source.matchAll(/sql\.Open\(\s*"sqlite",\s*([^\n]*?)\)\s*$/gm)) {
        opens.push(dsn);
      }
    }
    // A call the parser could not read (split across lines, another driver)
    // would otherwise go unchecked while the others keep `opens` non-empty.
    expect(opens.length).toBe(calls);
    expect(opens.length).toBeGreaterThan(0);
    for (const dsn of opens) {
      expect(dsn).toContain(ringoBusyTimeoutPragma);
      if (tablesOwnedBy("ringo").length === 0) expect(dsn).toContain("mode=ro");
    }
  });

  it("opens trailmap's connection with the protocol's journal mode and busy timeout", () => {
    const database = env.TASKS_DATABASE;
    setEnv("TASKS_DATABASE", database ?? "storage/test.sqlite3");
    try {
      expect(tasksDatabaseConfig()).toMatchObject({
        timeout: writeProtocol.busyTimeoutMs,
        pragmas: { journal_mode: writeProtocol.journalMode },
      });
    } finally {
      setEnv("TASKS_DATABASE", database);
    }
  });

  it("states the pragma ringo's DSN carries", async () => {
    expect(ringoBusyTimeoutPragma).toBe("_pragma=busy_timeout(5000)");
    expect(await read("docs/write-protocol.md")).toContain(ringoBusyTimeoutPragma);
  });
});
