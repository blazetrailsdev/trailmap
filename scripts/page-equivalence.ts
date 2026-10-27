/**
 * THE SHOW-PAGE GATE. Do not merge a show-page change past a mismatch.
 *
 * `render-the-rfc-and-story-show-pages` (#11) shipped `/rfc/<id>` and
 * `/story/<id>` under one criterion: for EVERY RFC and story in the database,
 * trailmap's page shows the same title, status, story list and done count as
 * ringo's. That was checked by hand over three RFCs and two pages. It found a
 * real defect — `rfcStoryCounts` dropping closed stories — so the check
 * earned its keep, and then it evaporated, because nothing repeats it.
 *
 * This is that criterion, run: both implementations asked for every id the
 * database holds, and their pages compared on the VALUES they state rather
 * than on their markup. The markup is deliberately different (#7's status
 * vocabulary, the GitHub restyle, ringo's action sidebar which trailmap does
 * not port), so `scripts/page-extract.ts` pulls the facts out of each side
 * and maps the two status vocabularies onto one before anything is compared.
 *
 * It is a MANUAL gate, not a CI job, and that is forced: ringo serves from a
 * checkout and a database that exist only on the box, and CI has neither. It
 * has to be run — and to keep working, it has to be run BEFORE ringo's read
 * model is deleted (`land-the-ringo-read-model-deletion`), after which there
 * is no reference implementation left to diff against. Worse than that: after
 * that story lands this gate still RUNS, comparing trailmap against pages
 * ringo now renders from trailmap's own API. It goes circular, not red.
 *
 * `--record` is the answer to that deadline. It rides along with an ordinary
 * run and, if the run is equivalent, writes what ringo said for every page —
 * and the database rows it said it over — to the two fixtures `pnpm
 * gate:snapshot` replays in CI with no ringo present. See README,
 * "The recorded show-page snapshot, and when to re-record it".
 *
 *     TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
 *     RINGO_BASE=http://10.200.0.60:8080 \
 *     TRAILMAP_BASE=http://127.0.0.1:3001 \
 *     pnpm gate:pages
 *
 * `RINGO_BASE` must reach ringo WITHOUT SSO — the public vhost answers a 302
 * to the login page, which the script reports as such rather than diffing a
 * redirect body. On the box that is the container's own address:
 *
 *     docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' btwhooks.web.1
 *
 * Both sides must be reading the SAME tasks checkout and database — trailmap
 * with `TASKS_DATABASE`/`TASKS_DIR` (README, "The show pages need the
 * markdown"). Pointing them at different data produces differences that are
 * real and are not about the port.
 */
import { Base } from "@blazetrails/activerecord";
import { argv, Dir, env, exit, getFs } from "@blazetrails/ruby-compat";
import { tasksDatabaseConfig } from "../config/database.ts";
import { Rfc, Story, loadModelSchemas } from "../app/models/index.ts";
import { storyStatusCounts } from "../app/models/concerns/rfc-progress.ts";
import {
  ROWS_FILE,
  SNAPSHOT_FILE,
  SNAPSHOT_TABLES,
  encodeRows,
  encodeSnapshot,
  pagesTouchedBy,
  type PageRecord,
  type RowRecord,
} from "./page-snapshot.ts";
import {
  diffFacts,
  extractRingoRfc,
  extractRingoStory,
  extractTrailmapRfc,
  extractTrailmapStory,
  barKey,
  ringoNotFound,
  trailmapRfcBars,
  type RfcPageFacts,
  type StoryPageFacts,
} from "./page-extract.ts";

/**
 * How many ids are in flight at once. The database holds thousands of
 * stories, so serial fetching turns a gate into an afternoon; ringo is a
 * single Go process on the same box, and eight is enough to saturate the
 * round trip without turning the gate into a load test of the thing it is
 * meant to be reading.
 */
const CONCURRENCY = 8;

/** How many mismatching ids to print before saying how many more there are. */
const REPORTED = 20;

/** Every difference, whether or not it fits on the terminal. */
const REPORT_FILE = "tmp/page-equivalence-problems.txt";

/**
 * `--record` writes ringo's extracted facts for every id to
 * `test/fixtures/ringo-show-pages.ndjson`, which `pnpm gate:snapshot` replays
 * in CI with no ringo present.
 *
 * Recording does not skip the comparison: the fixture is written by the same
 * pass that proves it equivalent, so a recording that reports a difference is
 * a recording nobody should commit. Re-recording is a deliberate step — see
 * README, "Re-recording the show-page snapshot".
 */
const RECORD = argv.includes("--record");

/**
 * How many times `--record` fetches again the pages the database moved under
 * before it gives up. Agents write the database throughout a run, so the rows
 * dumped at the end can disagree with facts fetched at the start; each round
 * re-fetches only the pages those writes reach (`pagesTouchedBy`), which takes
 * seconds, so a round's own window is small and a few rounds settle.
 */
const SETTLE_ROUNDS = 5;
/** `--self-test=bar`: only the `/rfcs` bar, with trailmap's side deliberately wrong. */
const BAR_SELF_TEST = argv.includes("--self-test=bar");

interface Fetched {
  html: string;
  status: number;
  /** The redirect an SSO'd vhost answers with, which is not a page at all. */
  redirectedTo: string | null;
}

async function main(): Promise<number> {
  const ringoBase = trimSlash(env.RINGO_BASE ?? "");
  const trailmapBase = trimSlash(env.TRAILMAP_BASE ?? "http://127.0.0.1:3001");
  if (ringoBase === "") {
    console.error("error: set RINGO_BASE to a URL that reaches ringo without SSO");
    console.error("       (see the header of this file for how to find it on the box)");
    return 1;
  }

  await Base.establishConnection(tasksDatabaseConfig());
  await loadModelSchemas();
  const rfcs = await Rfc.all().toArray();
  const stories = await Story.all().toArray();
  const rfcIds = rfcs.map((r) => r.id).sort();
  const storyIds = stories.map((s) => s.id).sort();
  // ringo's story SHOW page is served through `allStories`
  // (webhook/spawnloop.go:1384), which drops every story under a closed RFC
  // because it is the BACKLOG's filter. A permalink to a finished story
  // therefore answers "no story found" there and renders here — a divergence
  // trailmap chose, not one it drifted into, so the gate accounts for those
  // ids rather than failing on 4,573 of them and burying everything else.
  const closedRfc = new Set(rfcs.filter((r) => r.status === "closed").map((r) => r.id));
  let underClosedRfc = new Set(
    stories.filter((s) => closedRfc.has(s.rfc_id)).map((s) => s.id),
  );
  const exempt = new Set<string>();
  console.log(`ringo:    ${ringoBase}`);
  console.log(`trailmap: ${trailmapBase}`);
  console.log(`${rfcIds.length} RFCs, ${storyIds.length} stories\n`);

  if (BAR_SELF_TEST) {
    // The fault: `storyStatusCounts` handed "active" for every RFC.
    const wrong = new Map(
      rfcs.map((r) => {
        const own = stories.filter((s) => s.rfc_id === r.id).map((s) => s.status);
        return [r.id, Object.fromEntries(storyStatusCounts(own, "active").map((c) => [c.status, c.count]))];
      }),
    );
    const red = await compareBars(ringoBase, rfcIds, wrong);
    (await Base.leaseConnection()).disconnectBang();
    if (red.length > 0) {
      console.log(`SELF-TEST OK: the wrong RFC status turned the bar gate red (${red[0]})`);
      return 0;
    }
    console.error("SELF-TEST FAILED: the bar was built from the wrong RFC status and the gate stayed green");
    return 1;
  }

  // Rows come out in rowid order, and the replay inserts them in that order.
  // `story_deps` carries no ordering column, so a story's dependency list IS
  // its insertion order — and "deps returned alphabetically" was one of the
  // four defects this gate found. Dumping in primary-key order would have
  // re-introduced it inside the fixture.
  const snapshotRows = async (): Promise<RowRecord[]> => {
    const rows: RowRecord[] = [];
    for (const table of SNAPSHOT_TABLES) {
      const selected = (
      await (await Base.leaseConnection()).selectAll(`SELECT * FROM ${table} ORDER BY rowid`)
      ).toArray() as unknown as Record<string, unknown>[];
      for (const row of selected) rows.push({ table, row });
    }
    return rows;
  };
  // The rows as the run starts, for `settle` to tell what moved under it.
  let rowsBefore = RECORD ? await snapshotRows() : [];

  const problems: string[] = [];
  // Keyed by page, so `settle` replaces a page it fetches again in place.
  const records = new Map<string, PageRecord>();
  const record = (page: PageRecord): void => {
    records.set(`${page.kind}:${page.id}`, page);
  };
  const bars = new Map<string, Record<string, number>>();
  for (const tab of [...new Set(rfcs.map((r) => String(r.status)))]) {
    const url = `${trailmapBase}/rfcs?status=${encodeURIComponent(tab)}`;
    const first = (await get(url)).html;
    const pages = Number.parseInt(/class="pager" data-pages="(\d+)"/.exec(first)?.[1] ?? "1", 10);
    for (let page = 1; page <= pages; page++) {
      const html = page === 1 ? first : (await get(`${url}&page=${page}`)).html;
      try {
        for (const [id, bar] of trailmapRfcBars(html)) bars.set(id, bar);
      } catch (error) {
        problems.push(`/rfcs bar: ${url} page ${page}: ${(error as Error).message}`);
      }
    }
  }
  problems.push(...(await compareBars(ringoBase, rfcIds, bars)));
  const compareRfc = async (id: string): Promise<string[]> => {
    // ringo's story list lives on its stories TAB; its default tab is the
    // document. trailmap has no tabs and puts both on one page, so the two
    // URLs are not the same shape and cannot be.
    const [ringo, trailmap] = await Promise.all([
      get(`${ringoBase}/rfc/${encodeURIComponent(id)}/stories`),
      get(`${trailmapBase}/rfc/${encodeURIComponent(id)}`),
    ]);
    const differences = compare<RfcPageFacts>(
      ringo,
      trailmap,
      extractRingoRfc,
      extractTrailmapRfc,
    );
    if (RECORD && differences.length === 0 && !ringoNotFound(ringo.html)) {
      record({ kind: "rfc", id, ...extractRingoRfc(ringo.html) });
    }
    return differences;
  };
  const compareStory = async (id: string): Promise<string[]> => {
    const [ringo, trailmap] = await Promise.all([
      get(`${ringoBase}/story/${encodeURIComponent(id)}`),
      get(`${trailmapBase}/story/${encodeURIComponent(id)}`),
    ]);
    if (underClosedRfc.has(id) && ringoNotFound(ringo.html) && trailmap.status === 200) {
      exempt.add(id);
      if (RECORD) record({ kind: "story", id, exempt: true });
      return [];
    }
    const differences = compare<StoryPageFacts>(
      ringo,
      trailmap,
      extractRingoStory,
      extractTrailmapStory,
    );
    if (RECORD && differences.length === 0 && !ringoNotFound(ringo.html)) {
      record({ kind: "story", id, ...extractRingoStory(ringo.html) });
    }
    return differences;
  };
  problems.push(...(await compareAll("rfc", rfcIds, compareRfc)));
  problems.push(...(await compareAll("story", storyIds, compareStory)));

  /**
   * Bring the recorded facts and the rows to one moment. Each round dumps the
   * rows, names the pages the writes since the last dump reach, and fetches
   * those from both sides again, until a dump finds nothing moved. Answers the
   * rows to write, or `null` when the database would not hold still — or a
   * re-fetched page really differs — within `SETTLE_ROUNDS`.
   */
  const settle = async (): Promise<RowRecord[] | null> => {
    let unsettled: string[] = [];
    for (let round = 1; round <= SETTLE_ROUNDS; round++) {
      const rowsAfter = await snapshotRows();
      const touched = pagesTouchedBy(rowsBefore, rowsAfter);
      for (const page of unsettled) touched[page.startsWith("rfc:") ? "rfcs" : "stories"].add(page.slice(page.indexOf(":") + 1));
      if (touched.rfcs.size === 0 && touched.stories.size === 0) return rowsAfter;
      console.log(`settle ${round}: ${touched.rfcs.size} RFC and ${touched.stories.size} story pages moved under the run`);
      const closedNow = new Set(
        rowsAfter.filter((r) => r.table === "rfcs" && r.row.status === "closed").map((r) => String(r.row.id)),
      );
      const rfcNow = new Set(rowsAfter.filter((r) => r.table === "rfcs").map((r) => String(r.row.id)));
      const storyNow = new Map(
        rowsAfter.filter((r) => r.table === "stories").map((r) => [String(r.row.id), String(r.row.rfc_id)]),
      );
      underClosedRfc = new Set([...storyNow].filter(([, rfc]) => closedNow.has(rfc)).map(([id]) => id));
      unsettled = [];
      for (const id of touched.rfcs) {
        records.delete(`rfc:${id}`);
        if (rfcNow.has(id) && (await compareRfc(id)).length > 0) unsettled.push(`rfc:${id}`);
      }
      for (const id of touched.stories) {
        records.delete(`story:${id}`);
        exempt.delete(id);
        if (storyNow.has(id) && (await compareStory(id)).length > 0) unsettled.push(`story:${id}`);
      }
      rowsBefore = rowsAfter;
    }
    console.error(`settle: still moving after ${SETTLE_ROUNDS} rounds`);
    return null;
  };

  console.log(
    `\n${exempt.size} story pages ringo hides under a closed RFC and trailmap serves ` +
      `(a deliberate divergence, not a difference in what the two say)`,
  );

  // Every difference to a file, because the interesting ones are rarely the
  // first twenty and a terminal cannot hold thousands.
  const fs = getFs();
  const report = `${Dir.pwd()}/${REPORT_FILE}`;
  await fs.mkdir!(report.slice(0, report.lastIndexOf("/")), { recursive: true });
  await fs.writeFile!(report, `${problems.join("\n")}\n`);
  console.log(`all differences: ${report}`);

  if (problems.length === 0) {
    console.log(`\nEQUIVALENT: ${rfcIds.length + storyIds.length} pages agree, value for value.`);
    const rows = RECORD ? await settle() : null;
    if (RECORD && rows === null) {
      console.error("\nNOT RECORDED — the database did not hold still long enough to record.");
      (await Base.leaseConnection()).disconnectBang();
      return 1;
    }
    if (rows !== null) {
      const fixture = `${Dir.pwd()}/${SNAPSHOT_FILE}`;
      await fs.mkdir!(fixture.slice(0, fixture.lastIndexOf("/")), { recursive: true });
      await fs.writeFile!(fixture, encodeSnapshot([...records.values()]));
      console.log(`recorded ${records.size} pages to ${SNAPSHOT_FILE}`);
      await fs.writeFile!(`${Dir.pwd()}/${ROWS_FILE}`, encodeRows(rows));
      console.log(`recorded ${rows.length} rows to ${ROWS_FILE}`);
    }
    (await Base.leaseConnection()).disconnectBang();
    return 0;
  }
  // A fixture is written only by an equivalent run. Recording a difference
  // would freeze the defect into the thing CI replays, which is the one state
  // worse than not having a snapshot at all.
  if (RECORD) console.error("\nNOT RECORDED — the run was not equivalent.");
  (await Base.leaseConnection()).disconnectBang();

  console.error(`\nNOT EQUIVALENT — ${problems.length} differences:`);
  for (const problem of problems.slice(0, REPORTED)) console.error(`  ${problem}`);
  if (problems.length > REPORTED) {
    console.error(`  … and ${problems.length - REPORTED} more`);
  }
  return 1;
}

/**
 * THE `/rfcs` PROGRESS BAR: status and count per RFC, trailmap's segments
 * against the `story_status` ringo's server hands its own page
 * (`/spawnloop/rfcs`, which `storyBar` draws one segment per entry from).
 *
 * ringo's map is the EFFECTIVE status — its index applies the parent-RFC
 * override on load (`effectiveStoryStatus`, webhook/tasksdb.go) — so the one
 * status rule (`app/views/shared/_status-badge`) agrees with it.
 *
 * ONE KNOWN DIFFERENCE, stated rather than tolerated silently: since btwhooks
 * `6a18453` ringo also draws a `ready` story with unfinished deps as `blocked`
 * (`markDepBlocked`). trailmap does not port that yet
 * (`show-dep-held-ready-stories-as-blocked`, RFC 0136), so the two are
 * compared as ONE count (`barKey`). The override still crosses that line:
 * `ready` to `draft` leaves the folded count.
 */
async function compareBars(
  ringoBase: string,
  rfcIds: readonly string[],
  trailmap: ReadonlyMap<string, Record<string, number>>,
): Promise<string[]> {
  const response = await get(`${ringoBase}/spawnloop/rfcs`);
  if (response.status !== 200) return [`/rfcs bar: ringo answered ${response.status} for /spawnloop/rfcs`];
  const rows = (JSON.parse(response.html) as { rfcs: { id: string; story_status?: Record<string, number> }[] }).rfcs;
  const ringo = new Map(rows.map((r) => [r.id, r.story_status ?? {}]));
  const problems: string[] = [];
  for (const id of rfcIds) {
    const [left, right] = [ringo.get(id), trailmap.get(id)].map((bar) => bar && barKey(bar));
    if (left !== right) problems.push(`/rfcs bar ${id}: ringo=${left ?? "no row"} trailmap=${right ?? "no row"}`);
  }
  console.log(`ok  /rfcs bar (${rfcIds.length} rfcs, ${problems.length} differences)`);
  return problems;
}

/** Every id of one kind, `CONCURRENCY` at a time, with a progress line. */
async function compareAll(
  kind: string,
  ids: readonly string[],
  compareOne: (id: string) => Promise<string[]>,
): Promise<string[]> {
  const problems: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (let at = next++; at < ids.length; at = next++) {
      const id = ids[at];
      for (const problem of await compareOne(id)) problems.push(`/${kind}/${id}: ${problem}`);
      done++;
      if (done % 500 === 0 || done === ids.length) {
        console.log(`    ${kind}: ${done}/${ids.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  console.log(`ok  ${kind} (${ids.length} pages, ${problems.length} differences)`);
  return problems;
}

/**
 * One page from each side, compared — or the reason there was nothing to
 * compare.
 *
 * The both-missing case agrees deliberately. This database is under
 * continuous agent traffic and an id can be ingested away between the id list
 * and the fetch; two pages that both say "no such record" have not disagreed
 * about anything, while ONE of them saying it is exactly the defect worth
 * catching.
 */
function compare<T extends { title: string }>(
  ringo: Fetched,
  trailmap: Fetched,
  fromRingo: (html: string) => T,
  fromTrailmap: (html: string) => T,
): string[] {
  for (const [name, page] of [["ringo", ringo] as const, ["trailmap", trailmap] as const]) {
    if (page.redirectedTo !== null) {
      return [`${name} redirected to ${page.redirectedTo} — that base URL is behind SSO`];
    }
  }
  const ringoMissing = ringoNotFound(ringo.html);
  const trailmapMissing = trailmap.status === 404;
  if (ringoMissing && trailmapMissing) return [];
  if (ringoMissing !== trailmapMissing) {
    return [`ringo ${ringoMissing ? "has no record" : "has a record"}, trailmap ${trailmapMissing ? "has none" : "has one"}`];
  }
  if (ringo.status !== 200) return [`ringo answered ${ringo.status}`];
  if (trailmap.status !== 200) return [`trailmap answered ${trailmap.status}`];

  const left = fromRingo(ringo.html);
  const right = fromTrailmap(trailmap.html);
  // An empty title on a page that found its record means an extractor stopped
  // matching — a class rename on one side. Said plainly, because the diff it
  // would otherwise produce ("title: ringo="" trailmap=...") reads as a
  // content bug and sends the reader to the wrong repository.
  for (const [name, facts] of [["ringo", left] as const, ["trailmap", right] as const]) {
    if (facts.title === "") return [`${name}: no title extracted — its page markup has changed`];
  }
  return diffFacts(left, right);
}

/** One page, following no redirect, so an SSO bounce can be reported as one. */
async function get(url: string): Promise<Fetched> {
  const response = await fetch(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    return { html: "", status: response.status, redirectedTo: response.headers.get("location") };
  }
  return { html: await response.text(), status: response.status, redirectedTo: null };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

exit(await main());
