/**
 * THE GATE. Do not merge the port past a mismatch.
 *
 * The tasks repo already owns this idea — `pnpm gate` there proves the CLI's
 * database read-model matches the markdown one — and it exists because the
 * previous rewrite had to show it did not reorder anyone's work queue.
 * trailmap's models are a rewrite of exactly those ranking functions, so the
 * same gate applies: run BOTH implementations over the SAME database and diff
 * their output. Any difference is a defect in the port, not a variance to
 * tolerate.
 *
 * ONE SNAPSHOT, both sides. The tasks database is under continuous agent
 * traffic — stories are claimed and released while this runs — so comparing a
 * live read against another live read reports differences that are just two
 * different moments. The file is COPIED first and both sides are pointed at the
 * copy, which makes "same snapshot" structural rather than a timing hope. (A
 * stale tree shows up as a queue short by a handful of stories, which looks
 * exactly like a ranking bug and is not one.)
 *
 * The CLI side is the real binary, spawned with `TASKS_DB` at the snapshot and
 * asked for `--json`; the trailmap side is the models. Compared as the ordered
 * id sequence, byte for byte — order is part of the contract, because the spawn
 * loop consumes the queue in order.
 *
 *     TASKS_DATABASE=<tasks checkout>/.git/tasks.db pnpm gate  # TASKS_CLI=./tasks
 */
import { Base } from "@blazetrails/activerecord";
import { getFsAsync, getPathAsync } from "@blazetrails/activesupport";
import { getChildProcessAsync } from "@blazetrails/activesupport/child-process-adapter";
import { cwd, env, exit } from "@blazetrails/activesupport/process-adapter";
import { tasksDatabaseConfig } from "../config/database.js";
import { Rfc, Story, loadModelSchemas } from "../app/models/index.js";

/** The `--max-loc` budgets the spawn loop actually asks for. */
const BUDGETS = [100, 250, 500, 700];

/** Every story status, so `list`'s filter is covered end to end. */
const STATUSES = ["draft", "ready", "claimed", "in-progress", "done", "blocked", "closed"];

interface Case {
  label: string;
  args: string[];
  run: () => Promise<{ id: string }[]>;
}

async function main(): Promise<number> {
  const path = await getPathAsync();
  const fs = await getFsAsync();
  const child = await getChildProcessAsync();

  const tasksDir = env.TASKS_CLI ?? path.join(cwd(), "tasks");
  if (!(await fs.exists(path.join(tasksDir, "bin", "tasks")))) {
    console.error(`error: no tasks CLI at ${tasksDir} — set TASKS_CLI to the checkout`);
    return 1;
  }

  // `VACUUM INTO` rather than a file copy: it is SQLite's own consistent-
  // snapshot statement, taken under a read transaction, so it captures the
  // WAL's committed frames and nothing half-written. Copying the files by hand
  // instead is what a live database punishes — a stale `-shm` alongside a
  // freshly-written main file reads back SQLITE_CORRUPT, and skipping the WAL
  // reads back a queue quietly short by whatever committed last.
  const live = String(tasksDatabaseConfig().database);
  const snapshot = path.join(cwd(), "tmp", "equivalence-snapshot.sqlite3");
  await fs.mkdir!(path.dirname(snapshot), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    if (await fs.exists(snapshot + suffix)) await fs.unlink!(snapshot + suffix);
  }
  await Base.establishConnection(tasksDatabaseConfig());
  await Base.connection.execute(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  await Base.connection.disconnectBang();
  console.log(`snapshot: ${live} -> ${snapshot}`);

  await Base.establishConnection({ adapter: "sqlite3", database: snapshot, pool: 1 });
  await loadModelSchemas();

  // Scope the per-RFC `ready` cases to the RFCs that HAVE a claimable story,
  // plus one that does not. Those are the only RFCs where the `--rfc` filter
  // can disagree, and spawning the CLI once per RFC in the whole corpus would
  // put minutes into a gate that has to run on every PR.
  const queue = await Story.claimable();
  const rfcsWithQueue = [...new Set(queue.map((s) => s.rfc_id))].sort();
  const quiet = (await Rfc.all().toArray())
    .map((r) => r.id)
    .filter((id) => !rfcsWithQueue.includes(id))
    .sort()
    .slice(0, 1);

  const cases: Case[] = [
    { label: "ready", args: ["ready"], run: () => Story.claimable() },
    ...[...rfcsWithQueue, ...quiet].map((rfc) => ({
      label: `ready --rfc ${rfc}`,
      args: ["ready", "--rfc", rfc],
      run: () => Story.claimable({ rfc }),
    })),
    ...BUDGETS.map((maxLoc) => ({
      label: `next-bundle --max-loc ${maxLoc}`,
      args: ["next-bundle", "--max-loc", String(maxLoc)],
      run: () => Story.nextBundle({ maxLoc }),
    })),
    { label: "list", args: ["list"], run: () => Story.listFiltered() },
    ...STATUSES.map((status) => ({
      label: `list --status ${status}`,
      args: ["list", "--status", status],
      run: () => Story.listFiltered({ status }),
    })),
  ];

  // The child's stdout is REDIRECTED TO A FILE rather than buffered: an
  // unfiltered `list --json` is ~5MB of story rows, and spawnSync's default
  // 1MB buffer silently truncates it — which surfaced as a JSON syntax error
  // mid-object, not as "your output was cut off".
  const captured = path.join(cwd(), "tmp", "equivalence-cli-output.json");
  const problems: string[] = [];
  for (const c of cases) {
    const result = child.spawnSync(path.join(tasksDir, "bin", "tasks"), [...c.args, "--json"], {
      cwd: tasksDir,
      encoding: "utf8",
      env: { ...env, TASKS_DB: snapshot },
      out: captured,
    });
    if (result.status !== 0) {
      problems.push(`${c.label}: CLI exited ${result.status}: ${result.stderr.trim()}`);
      continue;
    }
    const cli = cliIds(await fs.readFile!(captured, "utf8")).join("\n");
    const models = (await c.run()).map((s) => s.id).join("\n");
    if (cli === models) {
      console.log(`ok  ${c.label} (${cli === "" ? 0 : cli.split("\n").length})`);
      continue;
    }
    problems.push(`${c.label}: ${describe(cli, models)}`);
  }

  if (problems.length === 0) {
    console.log(`\nEQUIVALENT: ${cases.length} cases, byte for byte.`);
    return 0;
  }
  console.error(`\nNOT EQUIVALENT — ${problems.length} of ${cases.length} cases differ:`);
  for (const p of problems) console.error(`  ${p}`);
  return 1;
}

/**
 * `next-bundle --json` emits an OBJECT (`{ stories, ... }`) because btwhooks
 * unmarshals it into a struct, while `ready` and `list` emit a bare array.
 * Accept both rather than branching per verb at the call site.
 */
function cliIds(stdout: string): string[] {
  const parsed: unknown = JSON.parse(stdout);
  const rows = Array.isArray(parsed)
    ? parsed
    : ((parsed as Record<string, unknown>).stories as unknown[]) ?? [];
  return rows.map((r) => String((r as { id: unknown }).id));
}

/** The first differing position, which is the only useful thing to report. */
function describe(cli: string, models: string): string {
  const a = cli === "" ? [] : cli.split("\n");
  const b = models === "" ? [] : models.split("\n");
  const at = a.findIndex((id, i) => id !== b[i]);
  const first = at === -1 ? Math.min(a.length, b.length) : at;
  return (
    `${a.length} cli vs ${b.length} trailmap; first difference at ${first} ` +
    `(cli=${a[first] ?? "(end)"} trailmap=${b[first] ?? "(end)"})`
  );
}

exit(await main());
