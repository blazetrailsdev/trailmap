import { Rfc } from "../app/models/rfc.ts";
import { Story } from "../app/models/story.ts";
import { StoryDep } from "../app/models/story-dep.ts";
import { StoryRfcDep } from "../app/models/story-rfc-dep.ts";
import { StoryPath } from "../app/models/story-path.ts";
import { StoryPackage } from "../app/models/story-package.ts";
import { Event } from "../app/models/event.ts";
import { Meta } from "../app/models/meta.ts";
import { Owner } from "../app/models/owner.ts";
import { Repository } from "../app/models/repository.ts";
import { RepositorySetting } from "../app/models/repository-setting.ts";
import { RepositoryCollaborator } from "../app/models/repository-collaborator.ts";
import { Setting } from "../app/models/setting.ts";
import { Audit } from "../app/models/audit.ts";
import { ParityDay } from "../app/models/parity-day.ts";
import { Hub } from "../app/models/hub.ts";
import { PullRequest } from "../app/models/pull-request.ts";
import { ApiCompareStat } from "../app/models/api-compare-stat.ts";
import { ApiComparePrivatesStat } from "../app/models/api-compare-privates-stat.ts";
import { TestCompareStat } from "../app/models/test-compare-stat.ts";
import { ApiCallsStat } from "../app/models/api-calls-stat.ts";
import { ApiCallArgsStat } from "../app/models/api-call-args-stat.ts";
import { PackageMeta } from "../app/models/package-meta.ts";
import { PackageTagStat } from "../app/models/package-tag-stat.ts";
import { PackageMarkStat } from "../app/models/package-mark-stat.ts";
import { PackageFileStat } from "../app/models/package-file-stat.ts";
import { PackageTagSite } from "../app/models/package-tag-site.ts";
import { PackageSkipTest } from "../app/models/package-skip-test.ts";
import { ClaudeMdSection } from "../app/models/claude-md-section.ts";

/**
 * The models on each of trailmap's three connections, and the schema warm-up
 * each connection's initializer awaits.
 *
 * Here and not in app/models: nothing in this file is a constant Zeitwerk could
 * seat, and lib/ is not an autoload path.
 */
// The task domain, on the SQLite tasks database.
const MODELS = [Rfc, Story, StoryDep, StoryRfcDep, StoryPath, StoryPackage, Event, Meta];

/**
 * The models on the OTHER connection — the `hub` Postgres database
 * (app/models/hub.ts).
 *
 * A separate list because `loadModelSchemas` reflects columns, and reflecting
 * these needs the hub connection, which `config/initializers/hub-database.ts`
 * establishes and a process without `HUB_DATABASE_URL` never has. Registration
 * is shared — that is process-global constant resolution, not a connection —
 * so `hasOne("settings")` resolves whether or not the database is reachable.
 */
const HUB_MODELS = [
  Owner,
  Repository,
  RepositorySetting,
  RepositoryCollaborator,
  Setting,
  // The parity projection. On the hub because it is Postgres data, even
  // though it is DERIVED from the stats database on a third connection —
  // see app/models/parity-day.ts.
  ParityDay,
  Audit,
];

/**
 * The models on the THIRD connection — the read-only trails stats database
 * (app/models/stats.ts).
 *
 * A separate list for the same reason `HUB_MODELS` is one: reflecting these
 * needs the stats connection, which `config/initializers/stats-database.ts`
 * establishes and a process without `STATS_DB` never has. Unlike the hub,
 * that is a supported way to run — the parity page says the source is missing
 * and every other page is unaffected.
 */
const STATS_MODELS = [
  PullRequest,
  ApiCompareStat,
  ApiComparePrivatesStat,
  TestCompareStat,
  ApiCallsStat,
  ApiCallArgsStat,
  PackageMeta,
  PackageTagStat,
  PackageMarkStat,
  PackageFileStat,
  PackageTagSite,
  PackageSkipTest,
  ClaudeMdSection,
];

export const ALL_MODELS = [...MODELS, ...HUB_MODELS, ...STATS_MODELS];

/**
 * Force every model's column information to load.
 *
 * `enum` resolves its storage type from the reflected column, and that
 * reflection is loaded lazily. Reaching a model for the FIRST time through an
 * association — `rfc.stories`, which is how a controller reads an RFC page —
 * builds it on a path that never loads columns, and the enum decorator then
 * throws "Undeclared attribute type for enum 'status' in Story". Touching
 * Story directly first happens to load the schema and hide it, so the failure
 * depends on which query a request ran first.
 *
 * Await this once after `establishConnection` and the order stops mattering.
 */
export async function loadModelSchemas(): Promise<void> {
  await Promise.all(MODELS.map((model) => model.loadSchema()));
}

/**
 * The same warm-up for the hub models, on the hub connection.
 *
 * Called by `config/initializers/hub-database.ts` right after it establishes
 * that connection — and only there, because without it these models have no
 * pool to reflect against.
 */
export async function loadHubSchemas(): Promise<void> {
  await Promise.all(HUB_MODELS.map((model) => model.loadSchema()));
}

/**
 * The same warm-up for the stats models, on the stats connection.
 *
 * AWAITING it is the whole point, and this connection is the one where
 * forgetting would show: `loadSchema()` is asynchronous, `columnNames()` is
 * not, and the parity page asks `columnNames()` which comparison runs this
 * database can chart. An unreflected model answers that with an empty list, so
 * a missed `await` here would not raise — it would come up with an empty run
 * picker, no chart, and nothing in the log.
 */
export async function loadStatsSchemas(): Promise<void> {
  await Promise.all(STATS_MODELS.map((model) => model.loadSchema()));
}

/**
 * The hub tables these models need that the connected database does not have.
 *
 * `loadHubSchemas` does NOT answer this: reflecting a model whose table is
 * missing SUCCEEDS, so a hub with no tables at all establishes a connection,
 * warms every schema and boots — then answers `relation "repositories" does
 * not exist` on the first page that reads a row. Measured against an empty
 * Postgres database, not assumed.
 *
 * Derived from `HUB_MODELS` rather than a written-out list, so a model added
 * above is checked without anyone remembering to add it here.
 */
export async function missingHubTables(): Promise<string[]> {
  const present = new Set(
    await Hub.connectionPool().withConnection((connection) => connection.tables()),
  );
  // `tableName` is typed nullable on the base class; every hub model sets one
  // explicitly, and a null would mean a model with no table at all — which is
  // not a missing TABLE and not this function's business.
  return HUB_MODELS.map((model) => model.tableName)
    .filter((table): table is string => table !== null && !present.has(table))
    .sort();
}
