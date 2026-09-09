/**
 * THE SHOW-PAGE SNAPSHOT GATE. Runs in CI, on every PR, with no ringo.
 *
 * `pnpm gate:pages` diffs trailmap's `/rfc/<id>` and `/story/<id>` against
 * ringo's live pages. It found four port defects that hand-verification had
 * missed — story-list order on every RFC, the authored status ranked instead
 * of the effective one, 259 rows labelled `ready` that the queue will not
 * offer, deps returned alphabetically — and it cannot run here: ringo serves
 * from a checkout and a database that exist only on the box.
 *
 * Worse, it is about to stop being a check at all. `land-the-ringo-read-model-
 * deletion` moves ringo's `loadIndex` onto trailmap's own API, after which
 * ringo's show pages render from data trailmap produced. `pnpm gate:pages`
 * would keep reporting EQUIVALENT while comparing trailmap against itself: it
 * goes circular, not red.
 *
 * So this replays a recording instead. `pnpm gate:pages --record` captured
 * what ringo's pages SAID, page by page, while ringo still had its own read
 * model; this asks trailmap for every one of those pages and diffs the same
 * facts, in the same vocabulary, against the recording. There is no fifth
 * defect it cannot catch that the live gate could — only a drift in the
 * database's own content, which is why the fixture is replayed against a
 * database built from the same content tree the recording was made from.
 *
 *     TASKS_DATABASE=<a database ingested from the tasks tree> \
 *     TASKS_DIR=<the tasks checkout> \
 *     pnpm gate:snapshot [--self-test]
 *
 * Pages are rendered in-process through `ActionController.TestCase`, the way
 * `pnpm gate:lists` renders its tabs — no server, no ports, nothing to boot.
 *
 * `--self-test` proves the gate still detects a difference: it perturbs one
 * recorded fact in memory and requires the replay to go red on it. Nothing is
 * written to the fixture in either mode.
 */
import { ActionController } from "@blazetrails/actionpack";
import { Base, MigrationContext } from "@blazetrails/activerecord";
import { getFsAsync, getPathAsync } from "@blazetrails/activesupport";
import { argv, cwd, exit } from "@blazetrails/activesupport/process-adapter";
import { loadModelSchemas } from "../app/models/index.js";
import { ApplicationController } from "../app/controllers/application-controller.js";
import { RfcPagesController } from "../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../app/controllers/story-pages-controller.js";
import {
  diffFacts,
  extractTrailmapRfc,
  extractTrailmapStory,
  type RfcPageFacts,
  type StoryPageFacts,
} from "./page-extract.js";
import {
  ROWS_FILE,
  SNAPSHOT_FILE,
  decodeRows,
  decodeSnapshot,
  factsOf,
  isExempt,
  type RfcRecord,
  type RowRecord,
  type StoryRecord,
} from "./page-snapshot.js";

/** How many mismatching ids to print before saying how many more there are. */
const REPORTED = 20;

/** Every difference, whether or not it fits on the terminal. */
const REPORT_FILE = "tmp/page-snapshot-problems.txt";

/**
 * A scratch database holding exactly the rows the recording was made from.
 *
 * `db/migrate` builds the schema, the same way `test/models/schema.ts` does, so
 * the replay runs against the migrations rather than a hand-written schema that
 * could drift from them.
 */
async function loadRecordedRows(rows: readonly RowRecord[]): Promise<void> {
  const path = await getPathAsync();
  await Base.establishConnection({ adapter: "sqlite3", database: ":memory:", pool: 1 });
  await new MigrationContext([path.resolve(cwd(), "db", "migrate")]).migrate();
  for (const { table, row } of rows) {
    const columns = Object.keys(row);
    await Base.connection.execQuery(
      `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")}) ` +
        `VALUES (${columns.map(() => "?").join(", ")})`,
      "snapshot row",
      columns.map((column) => row[column]),
    );
  }
}

/** One page from trailmap, dispatched through the controller that serves it. */
async function page(
  controller: typeof ApplicationController,
  id: string,
): Promise<{ status: number; html: string }> {
  const tc = new ActionController.TestCase(controller);
  await tc.get("show", { params: { id } });
  return { status: tc.response.status, html: tc.responseBody };
}

async function main(args: readonly string[]): Promise<number> {
  const selfTest = args.includes("--self-test");
  const fs = await getFsAsync();
  const fixture = `${cwd()}/${SNAPSHOT_FILE}`;
  if (!(await fs.exists(fixture))) {
    console.error(`error: no recording at ${SNAPSHOT_FILE}`);
    console.error("       record one against ringo with `pnpm gate:pages --record`");
    return 1;
  }
  const records = decodeSnapshot(await fs.readFile!(fixture, "utf8"));

  const rowsFile = `${cwd()}/${ROWS_FILE}`;
  if (!(await fs.exists(rowsFile))) {
    console.error(`error: no recorded rows at ${ROWS_FILE}`);
    return 1;
  }
  const rows = decodeRows(await fs.readFile!(rowsFile, "utf8"));
  await loadRecordedRows(rows);
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");
  console.log(`rows:      ${ROWS_FILE} (${rows.length} rows)`);

  const rfcs = records.filter((r): r is RfcRecord => r.kind === "rfc");
  const stories = records.filter((r): r is StoryRecord => r.kind === "story");
  const compared = stories.filter((r) => !isExempt(r));
  const exempt = stories.length - compared.length;
  console.log(`recording: ${SNAPSHOT_FILE}`);
  console.log(`${rfcs.length} RFCs, ${stories.length} stories (${exempt} exempt)\n`);

  const problems: string[] = [];
  for (const record of perturbed(rfcs, selfTest)) {
    const rendered = await page(RfcPagesController, record.id);
    problems.push(
      ...describe(`/rfc/${record.id}`, rendered.status, () =>
        diffFacts<RfcPageFacts>(factsOf(record), extractTrailmapRfc(rendered.html)),
      ),
    );
  }
  console.log(`ok  rfc (${rfcs.length} pages)`);

  for (const record of compared) {
    const rendered = await page(StoryPagesController, record.id);
    problems.push(
      ...describe(`/story/${record.id}`, rendered.status, () =>
        diffFacts<StoryPageFacts>(factsOf(record), extractTrailmapStory(rendered.html)),
      ),
    );
  }
  // ringo had no page for these, and trailmap has one. The recording says they
  // were exempt, not that they matched — so what is checked is the divergence
  // itself: trailmap must still SERVE the page ringo hid.
  for (const record of stories.filter(isExempt)) {
    const rendered = await page(StoryPagesController, record.id);
    if (rendered.status !== 200) {
      problems.push(
        `/story/${record.id}: recorded as a page ringo hides and trailmap serves, ` +
          `and trailmap answered ${rendered.status}`,
      );
    }
  }
  console.log(`ok  story (${stories.length} pages, ${exempt} exempt)`);

  await Base.connection.disconnectBang();

  const report = `${cwd()}/${REPORT_FILE}`;
  await fs.mkdir!(report.slice(0, report.lastIndexOf("/")), { recursive: true });
  await fs.writeFile!(report, `${problems.join("\n")}\n`);
  console.log(`all differences: ${report}`);

  if (selfTest) {
    if (problems.length > 0) {
      console.log("\nself-test: the gate still goes red on a difference.");
      return 0;
    }
    console.error("\nSELF-TEST FAILED — a perturbed recording replayed clean.");
    return 1;
  }
  if (problems.length === 0) {
    console.log(
      `\nEQUIVALENT: ${rfcs.length + compared.length} pages still say what ringo said.`,
    );
    return 0;
  }
  console.error(`\nNOT EQUIVALENT — ${problems.length} differences:`);
  for (const problem of problems.slice(0, REPORTED)) console.error(`  ${problem}`);
  if (problems.length > REPORTED) {
    console.error(`  … and ${problems.length - REPORTED} more`);
  }
  return 1;
}

/** One record's differences, or the reason trailmap had no page to diff. */
function describe(where: string, status: number, diff: () => string[]): string[] {
  if (status !== 200) return [`${where}: ringo had this page and trailmap answered ${status}`];
  return diff().map((problem) => `${where}: ${problem}`);
}

/**
 * The RFC records, with one fact bent under `--self-test`.
 *
 * The bent fact is a story-list ORDER, because order is what three of the four
 * defects the live gate found were about, and because a reordered list is the
 * difference a careless extractor is likeliest to stop noticing.
 */
function perturbed(records: readonly RfcRecord[], selfTest: boolean): RfcRecord[] {
  if (!selfTest) return [...records];
  const at = records.findIndex((record) => record.stories.length > 1);
  if (at === -1) return [...records];
  const bent = { ...records[at]!, stories: [...records[at]!.stories].reverse() };
  return records.map((record, i) => (i === at ? bent : record));
}

exit(await main(argv));
