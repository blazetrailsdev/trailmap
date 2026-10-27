import { ApplicationRecord } from "./application-record.ts";

/**
 * The base class of everything that lives in the `hub` database — the
 * GitHub-shaped owner/repository hierarchy (`Owner`, `Repository`,
 * `RepositorySetting`, `Setting`).
 *
 * `hub` is PostgreSQL and the task domain is SQLite, so this is Rails'
 * connection-per-abstract-class pattern: `config/initializers/hub-database.ts`
 * calls `Hub.establishConnection(hubDatabaseConfig())`, which sets this class's
 * `_connectionSpecificationName` to "Hub", and every subclass resolves its pool
 * through that name instead of `ActiveRecord::Base`'s. `Story` and `Rfc` keep
 * the `tasks.db` connection `config/initializers/tasks-database.ts` establishes
 * on `Base` itself, untouched.
 *
 * `abstractClass` is what makes that work AND what keeps the class tableless —
 * without it trails infers a `hubs` table and the subclasses inherit it.
 *
 * NOT `connectsTo({ database: { writing: "hub" } })`, which is how Rails would
 * normally spell this: `connectsTo` resolves its key against
 * `Base.configurations`, and the activerecord trailtie only registers those for
 * the `trails db` commands — the running application establishes both of its
 * connections by hand, from initializers. Switching to `connectsTo` means
 * registering the configurations at boot first; until then it raises
 * `AdapterNotSpecified` on the first query.
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
  }
}
