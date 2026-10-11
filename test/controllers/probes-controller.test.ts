import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getChildProcess, getFs, setEnv, type FsAdapter } from "@blazetrails/ruby-compat";
import { MigrationContext } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { HealthController } from "../../app/controllers/health-controller.js";
import { ProbesController } from "../../app/controllers/probes-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

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
  setEnv("TASKS_DIR", tasksDir);
  setEnv("TASKS_DATABASE", undefined);
});

afterAll(() => {
  for (const dir of dirs) getFs().rmSync(dir, { recursive: true, force: true });
  setEnv("TASKS_DIR", undefined);
  setEnv("GIT_CONFIG_GLOBAL", undefined);
  setEnv("GIT_CONFIG_NOSYSTEM", undefined);
});

describe("GET /up/ready", () => {
  beforeAll(() => setEnv("TASKS_DIR", tasksDir));

  it("answers 200 naming every check", async () => {
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.failing).toEqual([]);
    expect(Object.keys(body.checks)).toEqual([
      "database",
      "stories",
      "migrations",
      "checkout",
      "git_identity",
    ]);
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
    setEnv("TASKS_DIR", anonymousCheckout());
    const { status, body } = await getJson("ready");

    expect(status).toBe(503);
    expect(body.failing).toEqual(["git_identity"]);
    expect(body.checks.git_identity.error).toMatch(/^GIT_AUTHOR_IDENT: .*no email was given/s);
  });

  it("accepts an identity the environment supplies, as a commit would", async () => {
    setEnv("TASKS_DIR", anonymousCheckout());
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
    setEnv("TASKS_DIR", anonymousCheckout());
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
    setEnv("TASKS_DIR", awkward);
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.checks.checkout.dir).toBe(awkward);
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
    setEnv("TASKS_DIR", undefined);
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

describe("GET /up/deep", () => {
  it("reports the ready queue's row count and latency", async () => {
    const { status, body } = await getJson("deep");

    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.ready.rows).toBe(1);
    expect(body.ready.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("answers 503 when the queue cannot be computed", async () => {
    vi.spyOn(Story, "rankingIndex").mockRejectedValue(new Error("no such table: stories"));
    const { status, body } = await getJson("deep");

    expect(status).toBe(503);
    expect(body).toEqual({ status: "down", error: "no such table: stories" });
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
    const tc = await controllerTestCase(HealthController, { Host: "trailmap.deanoftech.com" });
    await tc.get("show");

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.response.body)).toEqual({ status: "ok" });
    expect(count).not.toHaveBeenCalled();
  });
});
