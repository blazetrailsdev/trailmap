import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setX } from "../support/config-x.ts";
import { getChildProcess, getFs, setEnv, registeredConstant, type FsAdapter } from "@blazetrails/ruby-compat";
import { MigrationContext } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ProbesController } from "../../app/controllers/probes-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  hubTestUrl,
  releaseHubTestDatabase,
} from "../support/hub-schema.ts";
import { Hub } from "../../app/models/hub.ts";
import { forgetTasksDatabaseIdentity, recordTasksDatabaseIdentity } from "../../config/database.ts";

const LOOPBACK = { Host: "127.0.0.1" };

/**
 * The last two versions under `db/migrate`, read off the file names rather
 * than asked of `MigrationContext`, which is the thing under test.
 */
const [PREVIOUS, HEAD] = getFs()
  .readdirSync("db/migrate")
  .filter((file) => /^\d+_/.test(file))
  .map((file) => Number(file.split("_")[0]))
  .sort((a, b) => a - b)
  .slice(-2) as [number, number];

async function getJson(
  action: string,
  headers: Record<string, string> = LOOPBACK,
): Promise<{ status: number; body: any }> {
  const tc = await controllerTestCase(ProbesController, headers);
  await tc.get(action);
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
}

function git(dir: string, ...args: string[]): void {
  const result = getChildProcess().spawnSync("git", ["-C", dir, ...args]);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

/** A git checkout with an identity of its own, standing in for the tasks one. */
function checkout(): string {
  const dir = getFs().mkdtempSync!("/tmp/trailmap-probes-");
  git(dir, "init", "--quiet");
  git(dir, "config", "user.name", "Probe");
  git(dir, "config", "user.email", "probe@example.test");
  return dir;
}

const dirs: string[] = [];
let tasksDir: string;

beforeAll(async () => {
  // Only the checkout's own config may supply an identity, or the developer's
  // global one would keep the identity check green whatever the checkout says.
  setEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  setEnv("GIT_CONFIG_NOSYSTEM", "1");
  tasksDir = checkout();
  dirs.push(tasksDir);

  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0143-production-smoke", status: "active", title: "smoke" });
  await Story.create({ id: "claimable", rfc_id: "0143-production-smoke", status: "ready" });
  await Story.create({ id: "finished", rfc_id: "0143-production-smoke", status: "done" });
});

afterEach(() => {
  vi.restoreAllMocks();
  ProbesController.deepTimeoutMs = 5_000;
  setX("tasks", "dir", tasksDir);
  setEnv("TASKS_DATABASE", undefined);
});

afterAll(() => {
  for (const dir of dirs) getFs().rmSync(dir, { recursive: true, force: true });
  setX("tasks", "dir", undefined);
  setEnv("GIT_CONFIG_GLOBAL", undefined);
  setEnv("GIT_CONFIG_NOSYSTEM", undefined);
});

describe("GET /up/ready", () => {
  beforeAll(() => setX("tasks", "dir", tasksDir));

  it("answers 200 naming every check", async () => {
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.failing).toEqual([]);
    expect(Object.keys(body.checks)).toEqual([
      "database",
      "stories",
      "migrations",
      "hub_migrations",
      "checkout",
      "git_identity",
    ]);
    expect(body.checks.hub_migrations).toEqual({ ok: true, skipped: "HUB_DATABASE_URL is not set" });
    expect(body.checks.migrations).toEqual({ ok: true, expected: HEAD, actual: HEAD });
    expect(body.checks.stories).toEqual({ ok: true, count: 2 });
    expect(body.checks.checkout).toEqual({ ok: true, dir: tasksDir });
  });

  it("goes red on the database alone, and cannot count stories without it", async () => {
    vi.spyOn(Story, "count").mockRejectedValue(new Error("database is locked"));
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.status).toBe("unready");
    expect(body.failing).toEqual(["database", "stories"]);
    expect(body.checks.database).toEqual({ ok: false, error: "database is locked" });
    expect(body.checks.stories.error).toMatch(/not counted/);
    expect(body.checks.checkout.ok).toBe(true);
    expect(body.checks.git_identity.ok).toBe(true);
  });

  // The pool keeps the file open, so the query still succeeds after the file
  // is moved aside; only the path can show it. Seen live, not inferred.
  it("goes red when the database file has been moved aside, though queries still answer", async () => {
    setEnv("TASKS_DATABASE", `${tasksDir}/.git/moved-aside.db`);
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["database", "stories"]);
    expect(body.checks.database.error).toMatch(/moved-aside\.db is gone/);
  });

  // A restore puts a DIFFERENT file at the same path: it exists, and the
  // connection still reads the old inode, so only the identity can show it.
  it("goes red when the database file was replaced after the connection opened it", async () => {
    const fs = getFs();
    const file = `${tasksDir}/.git/replaced.db`;
    fs.mkdirSync(`${tasksDir}/.git`, { recursive: true });
    fs.writeFileSync(file, "opened");
    setEnv("TASKS_DATABASE", file);
    await recordTasksDatabaseIdentity(file);
    try {
      expect((await getJson("ready")).status).toBe(200);

      fs.writeFileSync(`${file}.restored`, "restored");
      fs.renameSync(`${file}.restored`, file);
      const { status, body } = await getJson("ready");

      expect(status).toBe(503);
      expect(body.failing).toEqual(["database", "stories"]);
      expect(body.checks.database.error).toMatch(/replaced\.db was replaced: the connection opened dev \d+ ino \d+, and the path is now dev \d+ ino \d+/);
    } finally {
      forgetTasksDatabaseIdentity();
    }
  });

  it("says the identity went unchecked when none was recorded", async () => {
    const file = `${tasksDir}/.git/unrecorded.db`;
    getFs().mkdirSync(`${tasksDir}/.git`, { recursive: true });
    getFs().writeFileSync(file, "");
    setEnv("TASKS_DATABASE", file);
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.checks.database.identity).toMatch(/^unchecked: /);
  });

  it("goes red on an empty stories table alone", async () => {
    vi.spyOn(Story, "count").mockResolvedValue(0);
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["stories"]);
    expect(body.checks.stories).toEqual({ ok: false, count: 0, error: "the stories table is empty" });
  });

  // The un-migrated database is a real one: the last migration is rolled back,
  // not a row deleted, and then run again so the suite ends where it began.
  it("goes red naming both versions when the last migration did not run", async () => {
    const context = Story.connectionPool().migrationContext;
    await context.rollback();
    try {
      const { status, body } = await getJson("ready");

      expect(status).toBe(503);
      expect(body.failing).toEqual(["migrations"]);
      expect(body.checks.migrations).toEqual({
        ok: false,
        expected: HEAD,
        actual: PREVIOUS,
        error: `schema_migrations is at ${PREVIOUS}, and db/migrate expects ${HEAD}: a migration did not run`,
      });
    } finally {
      await context.migrate();
    }
    expect((await getJson("ready")).status).toBe(200);
  });

  it("goes red when the database is ahead of the release", async () => {
    vi.spyOn(MigrationContext.prototype, "currentVersion").mockResolvedValue(HEAD + 1);
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["migrations"]);
    expect(body.checks.migrations.error).toBe(
      `schema_migrations is at ${HEAD + 1}, and db/migrate expects ${HEAD}: the database is ahead of this release`,
    );
  });

  it("goes red on an unwritable checkout alone", async () => {
    const fs = getFs();
    fs.chmodSync!(tasksDir, 0o555);
    try {
      const { status, body } = await getJson("ready");

      expect(status).toBe(503);
      expect(body.failing).toEqual(["checkout"]);
      expect(body.checks.checkout.dir).toBe(tasksDir);
      expect(body.checks.checkout.error).toMatch(/EACCES/);
    } finally {
      fs.chmodSync!(tasksDir, 0o755);
    }
  });

  it("leaves nothing behind in the checkout", async () => {
    await getJson("ready");

    expect(getFs().readdirSync(tasksDir)).toEqual([".git"]);
  });

  // `user.useConfigOnly` is what makes this deterministic: without it git
  // guesses an address from the hostname, and whether that guess is acceptable
  // depends on the machine running the suite.
  function anonymousCheckout(): string {
    const dir = checkout();
    dirs.push(dir);
    git(dir, "config", "--unset", "user.email");
    git(dir, "config", "user.useConfigOnly", "true");
    return dir;
  }

  it("goes red on a missing git identity alone", async () => {
    setX("tasks", "dir", anonymousCheckout());
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["git_identity"]);
    expect(body.checks.git_identity.error).toMatch(/^GIT_AUTHOR_IDENT: .*no email was given/s);
  });

  it("accepts an identity the environment supplies, as a commit would", async () => {
    setX("tasks", "dir", anonymousCheckout());
    setEnv("GIT_AUTHOR_EMAIL", "author@example.test");
    setEnv("GIT_COMMITTER_EMAIL", "committer@example.test");
    try {
      const { status, body } = await getJson("ready");

      expect(status).toBe(200);
      expect(body.checks.git_identity).toEqual({ ok: true });
    } finally {
      setEnv("GIT_AUTHOR_EMAIL", undefined);
      setEnv("GIT_COMMITTER_EMAIL", undefined);
    }
  });

  it("names the committer when only the author has an identity", async () => {
    setX("tasks", "dir", anonymousCheckout());
    setEnv("GIT_AUTHOR_EMAIL", "author@example.test");
    try {
      const { body } = await getJson("ready");

      expect(body.failing).toEqual(["git_identity"]);
      expect(body.checks.git_identity.error).toMatch(/^GIT_COMMITTER_IDENT: /);
    } finally {
      setEnv("GIT_AUTHOR_EMAIL", undefined);
    }
  });

  it("reads a checkout whose path the shell would split or expand", async () => {
    const awkward = getFs().mkdtempSync!("/tmp/trailmap probes $HOME 'q' ");
    dirs.push(awkward);
    git(awkward, "init", "--quiet");
    git(awkward, "config", "user.name", "Probe");
    git(awkward, "config", "user.email", "probe@example.test");
    setX("tasks", "dir", awkward);
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.checks.checkout.dir).toBe(awkward);
  });

  it("sweeps a probe directory orphaned by a kill, but not a concurrent one", async () => {
    const old = `${tasksDir}/.up-ready-killed`;
    const fresh = `${tasksDir}/.up-ready-running`;
    getFs().mkdirSync(old);
    getFs().mkdirSync(fresh);
    const longAgo = new Date(Date.now() - ProbesController.probeSweepAgeMs - 60_000);
    getFs().utimesSync!(old, longAgo, longAgo);
    try {
      const { body } = await getJson("ready");

      expect(body.checks.checkout.ok).toBe(true);
      expect(getFs().readdirSync(tasksDir).sort()).toEqual([".git", ".up-ready-running"]);
    } finally {
      getFs().rmdirSync(fresh);
    }
  });

  it("does not go red when the sweep cannot read the checkout", async () => {
    vi.spyOn(getFs() as Required<FsAdapter>, "readdir").mockRejectedValue(new Error("EIO: sweep failed"));
    const { body } = await getJson("ready");

    expect(body.checks.checkout.ok).toBe(true);
  });

  it("names the leftover when the probe directory cannot be removed", async () => {
    vi.spyOn(getFs() as Required<FsAdapter>, "rmdir").mockRejectedValue(new Error("EBUSY: resource busy"));
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["checkout"]);
    expect(body.checks.checkout.error).toMatch(/^left .*\.up-ready-\w+ behind: EBUSY/);
  });

  it("names the check that raised rather than answering a bare 500", async () => {
    vi.spyOn(getFs() as Required<FsAdapter>, "mkdtemp").mockImplementation(() => {
      throw new Error("adapter exploded");
    });
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["checkout"]);
    expect(body.checks.checkout.error).toBe("adapter exploded");
  });

  it("names both checkout checks when no checkout is configured", async () => {
    setX("tasks", "dir", undefined);
    setEnv("TASKS_DATABASE", undefined);
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["checkout", "git_identity"]);
  });

  it("is a 404 from the public hostname", async () => {
    const { status, body } = await getJson("ready", {
      Host: "trailmap.deanoftech.com",
      "X-Forwarded-For": "203.0.113.7",
    });

    expect(status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });
});

describe.skipIf(!hasHubTestDatabase())("GET /up/ready against the hub", () => {
  /** The last two versions under `db/hub-migrate`, read off the file names. */
  const [HUB_PREVIOUS, HUB_HEAD] = getFs()
    .readdirSync("db/hub-migrate")
    .filter((file) => /^\d+_/.test(file))
    .map((file) => Number(file.split("_")[0]))
    .sort((a, b) => a - b)
    .slice(-2) as [number, number];

  beforeAll(async () => {
    setX("tasks", "dir", tasksDir);
    await connectHubTestDatabase();
  }, HUB_SETUP_TIMEOUT);

  afterAll(async () => {
    await releaseHubTestDatabase();
  });

  it("reports the hub head beside the task domain's", async () => {
    setEnv("HUB_DATABASE_URL", hubTestUrl()!);
    try {
      const { status, body } = await getJson("ready");

      expect(status).toBe(200);
      expect(body.checks.hub_migrations).toEqual({ ok: true, expected: HUB_HEAD, actual: HUB_HEAD });
    } finally {
      setEnv("HUB_DATABASE_URL", undefined);
    }
  });

  // The head's ROW is removed, not the migration reverted as the task-domain
  // case does: run in-process, the migrator leases `ActiveRecord::Base`'s
  // connection (test/support/hub-schema.ts says why the hub tests never
  // migrate here), so `rollback()` would revert the hub's migration against
  // SQLite. The row is what the check reads, and it is put back after.
  it("goes red on the hub head alone when its last migration did not run", async () => {
    setEnv("HUB_DATABASE_URL", hubTestUrl()!);
    const head = (sql: string) => Hub.connectionPool().withConnection((c) => c.execute(sql));
    await head(`DELETE FROM schema_migrations WHERE version = '${HUB_HEAD}'`);
    try {
      const { status, body } = await getJson("ready");

      expect(status).toBe(503);
      expect(body.failing).toEqual(["hub_migrations"]);
      expect(body.checks.migrations.ok).toBe(true);
      expect(body.checks.hub_migrations).toEqual({
        ok: false,
        expected: HUB_HEAD,
        actual: HUB_PREVIOUS,
        error: `schema_migrations is at ${HUB_PREVIOUS}, and db/hub-migrate expects ${HUB_HEAD}: a migration did not run`,
      });
    } finally {
      await head(`INSERT INTO schema_migrations (version) VALUES ('${HUB_HEAD}')`);
      setEnv("HUB_DATABASE_URL", undefined);
    }
  });
});

describe("GET /up/deep", () => {
  it("reports the ready queue's row count and latency", async () => {
    const { status, body } = await getJson("deep");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.ready.rows).toBe(1);
    expect(body.ready.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("answers 503 when the queue cannot be computed", async () => {
    vi.spyOn(Story, "readyQueue").mockRejectedValue(new Error("no such table: stories"));
    const { status, body } = await getJson("deep");

    expect(status).toBe(503);
    expect(body).toEqual({ status: "down", error: "no such table: stories" });
  });

  it("answers 503 naming the timeout when the queue outruns its bound", async () => {
    let settle!: (error: Error) => void;
    vi.spyOn(Story, "readyQueue").mockReturnValue(new Promise((_, reject) => (settle = reject)));
    ProbesController.deepTimeoutMs = 20;
    const { status, body } = await getJson("deep");
    // The run outlives its caller, and holds the slot until it settles.
    settle(new Error("abandoned"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(status).toBe(503);
    expect(body).toEqual({
      status: "down",
      error: "timeout: the ready queue took longer than 20ms",
    });
  });

  it("answers 503 when a ranking that never yielded finished past the bound", async () => {
    // Synchronous, as SQLite is here: no timer can fire until it returns.
    const original = Story.readyQueue.bind(Story);
    vi.spyOn(Story, "readyQueue").mockImplementation(async (opts) => {
      const until = performance.now() + 30;
      while (performance.now() < until);
      return original(opts);
    });
    ProbesController.deepTimeoutMs = 10;
    const { status, body } = await getJson("deep");

    expect(status).toBe(503);
    expect(body.error).toMatch(/^timeout: /);
  });

  it("shares one ranking between overlapping requests", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const original = Story.readyQueue.bind(Story);
    const ranking = vi.spyOn(Story, "readyQueue").mockImplementation(async () => {
      await held;
      return original();
    });
    const both = Promise.all([getJson("deep"), getJson("deep")]);
    // Both requests are parked on the one run before it is let go.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();

    for (const { status, body } of await both) {
      expect(status).toBe(200);
      expect(body.ready.rows).toBe(1);
    }
    expect(ranking).toHaveBeenCalledTimes(1);
  });

  it("is a 404 from the public hostname", async () => {
    const { status } = await getJson("deep", {
      Host: "trailmap.deanoftech.com",
      "X-Forwarded-For": "203.0.113.7",
    });

    expect(status).toBe(404);
  });
});

describe("GET /up", () => {
  it("still answers 200 with the database red, from any host", async () => {
    const count = vi.spyOn(Story, "count").mockRejectedValue(new Error("database is locked"));
    const health = registeredConstant("Rails::HealthController") as unknown as typeof ProbesController;
    const tc = await controllerTestCase(health, { Host: "trailmap.deanoftech.com" });
    await tc.get("show");

    expect(tc.response.status).toBe(200);
    expect(count).not.toHaveBeenCalled();
  });
});
