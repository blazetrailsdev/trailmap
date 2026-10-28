import { ApplicationRecord } from "./application-record.ts";
import { hasHubDatabase } from "../../config/database.ts";

/**
 * The base class of everything that lives in the `hub` database — the
 * GitHub-shaped owner/repository hierarchy (`Owner`, `Repository`,
 * `RepositorySetting`, `Setting`).
 *
 * `hub` is PostgreSQL and the task domain is SQLite, so this is Rails'
 * connection-per-abstract-class pattern, spelled as Rails spells it:
 * `connectsTo({ database: { writing: ":hub" } })` resolves the `hub` entry of
 * `config/database.ts` against `Base.configurations`, which the activerecord
 * trailtie sets at boot, and names this class's pool "Hub". `Story` and `Rfc`
 * keep the `tasks.db` connection `config/initializers/tasks-database.ts`
 * establishes on `Base` itself, untouched.
 *
 * Connecting opens no socket, and an unset `HUB_DATABASE_URL` registers no
 * pool, so a missing hub fails at the first query (`ConnectionNotDefined`)
 * rather than at import; `config/initializers/hub-schema.ts` is what refuses
 * to SERVE without one.
 *
 * `abstractClass` is what makes that work AND what keeps the class tableless —
 * without it trails infers a `hubs` table and the subclasses inherit it.
 *
 * Nothing joins across the two databases, and nothing can: a query that spans
 * them is two queries and a join in TypeScript. Where a page needs both — every
 * repo tab does — the repo scope is a `where` on the string the task domain
 * already carries (`stories.pr` is `repo#N`, `story_paths.path` is repo-relative).
 */
export class Hub extends ApplicationRecord {
  static {
    // ASSIGNED in a static block, never `static abstractClass = true`.
    // `abstractClass` is an accessor pair on the library's class methods whose
    // getter answers `hasOwnProperty(this, "_abstractClass")` — Rails' own
    // per-class ivar semantics, so a subclass is NOT abstract. A class FIELD
    // defines an own data property on this class instead, shadowing the
    // accessor, and a static data property IS inherited: every subclass then
    // reads `abstractClass === true` and `Owner.create()` raises "Owner is an
    // abstract class and cannot be instantiated". Assignment runs the setter.
    this.abstractClass = true;
    // Only when the entry names a database. An entry with no URL would still
    // register a pool, aimed at libpq's defaults, and every caller that
    // reads "no hub" as `ConnectionNotDefined` (Setting.findByKey) would get
    // a refused socket instead.
    if (hasHubDatabase()) void this.connectsTo({ database: { writing: ":hub" } });
  }
}
