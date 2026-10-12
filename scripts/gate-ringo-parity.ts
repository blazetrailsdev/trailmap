/**
 * THE PARITY-GRAPH GATE. `/graphs/parity` was ported from ringo's page of the
 * same name, and the only thing holding a port still is a comparison against
 * the thing it was ported from — see the longer argument at the top of
 * scripts/gate-ringo-lists.ts, which this follows.
 *
 * What it compares: trailmap's `/graphs/parity/data` against ringo's
 * `/spawnloop/parity`, over THE SAME stats database, for every metric the
 * either side offers, across several package sets and windows. The two
 * endpoints answer the same JSON contract — deliberately, so the drawing code
 * (which is ringo's own, vendored) needs no adaptation — so the comparison is
 * the documents, not a re-description of them.
 *
 * TWO WAYS TO RUN IT, and the comparison is the same code in both.
 *
 * `--fixture` is the one CI runs. ringo's side is ringo's own handler, built
 * from the vendored pin (scripts/ringo-parity-answers.sh compiles
 * vendor/ringo/db/parity.go) with no ringo running; trailmap's side is the
 * controller action, called in-process. Both read ONE small stats database
 * this script writes first — every comparison table, dated relative to today
 * so the 30/90/365-day windows each cut it somewhere different — and trailmap
 * reads it the way production does, through the `parity_days` projection in
 * Postgres. So it needs Go and a throwaway hub database, and nothing else:
 *
 *     HUB_TEST_DATABASE_URL=postgres://... pnpm gate:parity --fixture
 *
 * `--fixture --self-test` changes one of trailmap's points and requires the
 * gate to go red, so a comparison that stopped looking cannot pass.
 *
 * With no flag it asks a RUNNING ringo and a running trailmap over the live
 * stats database, which is the multi-gigabyte check the box can make and CI
 * cannot:
 *
 *     RINGO_BASE=http://10.200.0.48:8080 TRAILMAP_BASE=http://127.0.0.1:4567 \
 *       pnpm tsx scripts/gate-ringo-parity.ts
 *
 * Compared: the offered metric list, each metric's gap columns, the package
 * list, the refusals, and every series point — date, PR, percent, matched,
 * total and each gap count. A difference in any of them is a difference in
 * what the page would draw.
 */

import { argv, Dir, env, exit, getChildProcessAsync, getFs, getPath, setEnv } from "@blazetrails/ruby-compat";
import { Stats } from "../app/models/stats.js";
import { ParityDay } from "../app/models/parity-day.js";
import { ApplicationController } from "../app/controllers/application-controller.js";
import { ParityGraphsController } from "../app/controllers/parity-graphs-controller.js";
import { controllerTestCase } from "../test/support/controller-test-case.js";
import { connectHubTestDatabase, hasHubTestDatabase, releaseHubTestDatabase } from "../test/support/hub-schema.js";
import { createScratchStatsDatabase } from "../test/models/stats-schema.js";

const fixture = argv.includes("--fixture");
const selfTest = argv.includes("--self-test");

const ringoBase = env.RINGO_BASE ?? "http://10.200.0.48:8080";
const trailmapBase = env.TRAILMAP_BASE ?? "http://127.0.0.1:4567";

/** The query sets to compare. Each exercises a different part of the shape. */
const CASES: Record<string, string>[] = [
  { metrics: "api", packages: "activerecord", days: "90" },
  { metrics: "api,test", packages: "activerecord,actionpack", days: "90" },
  { metrics: "test_files,test_assert_count,test_assert_kind", packages: "activerecord", days: "365" },
  { metrics: "api_privates", packages: "activesupport,arel", days: "all" },
  // The call tables hold only the synthetic `all` package, so a request naming
  // a real one must drop it rather than fail.
  { metrics: "calls,call_args", packages: "activerecord,all", days: "all" },
  // No packages at all: the picker's own payload, with no series.
  { metrics: "api", days: "30" },
];

interface Payload {
  metrics_selected?: string[];
  gaps_by_metric?: Record<string, string[] | null>;
  metrics?: { key: string; label: string; gaps: string[] | null }[];
  packages?: string[];
  unknown_packages?: string[] | null;
  max_packages?: number;
  series?: { metric: string; package: string; points: Record<string, unknown>[] }[];
  error?: string;
}

async function fetchJson(base: string, path: string, query: Record<string, string>) {
  const url = `${base}${path}?${new URLSearchParams(query).toString()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as Payload;
}

/**
 * The fixture stats database: every comparison table, small.
 *
 * PRs are dated in DAYS BEFORE TODAY, because the windows are: a fixed date
 * would slide out of `days=30` and then `days=90` as the file aged, and the
 * gate would go on passing while comparing less and less. None sits on a
 * window's edge, so the two sides computing "today" a moment apart cannot
 * disagree about one. Two PRs share a day, which is the rollup's own rule —
 * a day is its LAST merge.
 *
 * The tables do not have the same columns and that is the point of covering
 * all of them: the privates run has no `misplaced`, the call tables have only
 * `mismatched`, and the three derived test metrics read columns nothing else
 * does. Both defects the live gate found were of that kind — gap columns
 * looked up for the wrong table, and one select list used for every table.
 */
const FIXTURE_PRS = [400, 200, 100, 45, 20, 20, 3].map((daysAgo, at) => ({ number: 7000 + at, daysAgo, at }));

async function writeFixture(file: string): Promise<void> {
  await createScratchStatsDatabase(file);
  const adapter = await Stats.connectionPool().leaseConnection();
  const insert = async (table: string, row: Record<string, string | number>) => {
    const values = Object.values(row).map((v) => (typeof v === "number" ? String(v) : `'${v}'`));
    await adapter.execute(`INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${values.join(", ")})`);
  };
  const today = Date.now();
  for (const pr of FIXTURE_PRS) {
    const mergedAt = new Date(today - pr.daysAgo * 86_400_000);
    // The two same-day PRs an hour apart, the later number the later merge.
    mergedAt.setUTCHours(10 + pr.at, 0, 0, 0);
    const sha = `sha${pr.number}`;
    await insert("pull_requests", {
      number: pr.number,
      merge_commit_sha: sha,
      merged_at: mergedAt.toISOString().replace(".000Z", "Z"),
    });
    const key = { merge_commit_sha: sha, pr_number: pr.number };
    const run = (total: number, step: number) => {
      const matched = total - 60 + pr.at * step;
      return { matched, total, percent: Math.round((1000 * matched) / total) / 10 };
    };
    for (const [n, name] of ["activerecord", "actionpack", "activesupport", "arel"].entries()) {
      await insert("api_compare_stats", {
        ...key, package: name, ...run(900 - n * 150, 7 - n), misplaced: 9 - pr.at, missing: 40 - pr.at * (n + 1),
      });
    }
    for (const [n, name] of ["activesupport", "arel"].entries()) {
      await insert("api_compare_privates_stats", { ...key, package: name, ...run(300 + n * 50, 5), missing: 55 - pr.at * 4 });
    }
    // actionpack's test run starts later than activerecord's: a package with
    // fewer points than its neighbour on the same chart.
    for (const [n, name] of ["activerecord", "actionpack"].entries()) {
      if (n === 1 && pr.at < 2) continue;
      await insert("test_compare_stats", {
        ...key, package: name, ...run(2000 - n * 800, 6),
        skipped: 12 + pr.at, files_mapped: 80 + pr.at * 3, files_total: 120, misplaced: 4 + n,
        assertion_count_mismatch: 30 - pr.at * 2, assertion_kind_mismatch: 17 - pr.at,
      });
    }
    await insert("api_calls_stats", { ...key, package: "all", ...run(5000, 8), mismatched: 60 - pr.at * 8 });
    await insert("api_call_args_stats", { ...key, package: "all", ...run(3100, 4), mismatched: 60 - pr.at * 4 });
  }
}

/**
 * Both sides' answers to every case, over the fixture.
 *
 * ringo's come from ONE `go run`, a line per case. trailmap's come after the
 * projection has been rebuilt from the same file, which is the path a page
 * load takes in production.
 */
async function fixtureAnswers(): Promise<{ theirs: Payload[]; mine: Payload[] }> {
  if (!hasHubTestDatabase()) {
    throw new Error("--fixture projects into Postgres: set HUB_TEST_DATABASE_URL to a THROWAWAY hub database.");
  }
  const [fs, path, child] = await Promise.all([getFs(), getPath(), getChildProcessAsync()]);
  const dir = path.join(Dir.pwd(), "tmp", "parity-fixture");
  const file = path.join(dir, "stats.db");
  await fs.mkdir!(dir, { recursive: true });
  // A fresh file every run: the dates in it are relative to today.
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (await fs.exists(file + suffix)) await fs.unlink!(file + suffix);
  }
  await writeFixture(file);

  const queries = CASES.map((query) => new URLSearchParams(query).toString());
  const result = child.spawnSync(path.join(Dir.pwd(), "scripts", "ringo-parity-answers.sh"), queries, {
    encoding: "utf8",
    env: { ...env, STATS_DB: file },
  });
  if (result.status !== 0) throw new Error(`ringo's handler exited ${result.status}: ${result.stderr.trim()}`);
  const theirs = result.stdout.trim().split("\n").map((line: string) => JSON.parse(line) as Payload);
  if (theirs.length !== CASES.length) throw new Error(`ringo answered ${theirs.length} of ${CASES.length} cases`);

  setEnv("STATS_DB", file);
  ApplicationController.prependViewPath("app/views");
  await connectHubTestDatabase();
  try {
    await ParityDay.refreshFromStats();
    const mine: Payload[] = [];
    for (const query of CASES) {
      const tc = await controllerTestCase(ParityGraphsController);
      await tc.get("data", { params: query });
      mine.push(JSON.parse(String(tc.response.body)) as Payload);
    }
    return { theirs, mine };
  } finally {
    await releaseHubTestDatabase();
  }
}

/**
 * JSON with object keys in a fixed order.
 *
 * Go marshals a map with its keys SORTED and JavaScript emits them in
 * insertion order, so the two sides' `gaps` objects and `gaps_by_metric` spell
 * the same values in a different order. That is not a difference in anything
 * the page draws, and comparing raw `JSON.stringify` output reports it on
 * every single point — the first run of this gate produced 96 such reports and
 * not one real one. ARRAYS keep their order, because series order and package
 * order are part of the answer (the page assigns a colour from the package's
 * position).
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

const failures: string[] = [];
function check(label: string, mine: unknown, theirs: unknown): void {
  const a = JSON.stringify(canonical(mine));
  const b = JSON.stringify(canonical(theirs));
  if (a !== b) failures.push(`${label}\n    ringo:    ${b}\n    trailmap: ${a}`);
}

/** `null` and `[]` are the same answer; Go marshals an empty slice as null. */
function list(value: string[] | null | undefined): string[] {
  return value ?? [];
}

const fromFixture = fixture ? await fixtureAnswers() : null;
if (fromFixture !== null && selfTest) {
  const point = fromFixture.mine.flatMap((p) => p.series ?? []).flatMap((series) => series.points)[0];
  if (point === undefined) throw new Error("the fixture charted no point to change");
  point.matched = Number(point.matched) + 1;
}
let points = 0;

for (const [at, query] of CASES.entries()) {
  const name = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const [theirs, mine] =
    fromFixture !== null
      ? [fromFixture.theirs[at]!, fromFixture.mine[at]!]
      : await Promise.all([
          fetchJson(ringoBase, "/spawnloop/parity", query),
          fetchJson(trailmapBase, "/graphs/parity/data", query),
        ]);

  if (theirs.error || mine.error) {
    check(`[${name}] error`, mine.error ?? null, theirs.error ?? null);
    continue;
  }

  check(`[${name}] metrics_selected`, mine.metrics_selected, theirs.metrics_selected);
  check(`[${name}] packages`, mine.packages, theirs.packages);
  check(`[${name}] unknown_packages`, list(mine.unknown_packages), list(theirs.unknown_packages));
  check(`[${name}] max_packages`, mine.max_packages, theirs.max_packages);

  // The offered metric list, key by key, with each one's gap columns.
  const theirOffered = (theirs.metrics ?? []).map((m) => [m.key, m.label, list(m.gaps)]);
  const myOffered = (mine.metrics ?? []).map((m) => [m.key, m.label, list(m.gaps)]);
  check(`[${name}] metrics offered`, myOffered, theirOffered);

  const theirGaps = Object.fromEntries(
    Object.entries(theirs.gaps_by_metric ?? {}).map(([k, v]) => [k, list(v)]),
  );
  const myGaps = Object.fromEntries(
    Object.entries(mine.gaps_by_metric ?? {}).map(([k, v]) => [k, list(v)]),
  );
  check(`[${name}] gaps_by_metric`, myGaps, theirGaps);

  // Series, keyed by (metric, package) so an ordering difference is reported
  // as one rather than as every point being wrong.
  const key = (s: { metric: string; package: string }) => `${s.metric}/${s.package}`;
  const theirSeries = new Map((theirs.series ?? []).map((s) => [key(s), s]));
  const mySeries = new Map((mine.series ?? []).map((s) => [key(s), s]));
  check(`[${name}] series keys`, [...mySeries.keys()], [...theirSeries.keys()]);

  for (const [k, theirOne] of theirSeries) {
    const myOne = mySeries.get(k);
    if (!myOne) continue;
    check(`[${name}] ${k} point count`, myOne.points.length, theirOne.points.length);
    const n = Math.min(myOne.points.length, theirOne.points.length);
    points += n;
    for (let i = 0; i < n; i += 1) {
      check(`[${name}] ${k} point ${i}`, myOne.points[i], theirOne.points[i]);
    }
  }
}

if (selfTest) {
  // One point was changed, so exactly that must be reported.
  if (failures.length === 0) {
    console.error("gate-ringo-parity: SELF-TEST FAILED — a changed point passed the gate");
    exit(1);
  }
  console.log(`gate-ringo-parity: self-test ok — a changed point was reported (${failures.length} difference(s))`);
  exit(0);
}
if (failures.length > 0) {
  console.error(`gate-ringo-parity: ${failures.length} difference(s) from ringo\n`);
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  exit(1);
}
// A fixture that charted nothing would agree with ringo about nothing.
if (fixture && points < 50) {
  console.error(`gate-ringo-parity: only ${points} points were compared — the fixture is not being read`);
  exit(1);
}
console.log(`gate-ringo-parity: ${CASES.length} cases agree with ringo, point for point (${points} points)`);
exit(0);
