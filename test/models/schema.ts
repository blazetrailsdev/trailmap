import { getPathAsync } from "@blazetrails/activesupport";
import { cwd } from "@blazetrails/activesupport/process-adapter";
import { Base, MigrationContext } from "@blazetrails/activerecord";

/**
 * Bring an in-memory database up to the current schema.
 *
 * `MigrationContext` is Rails' own entry point — it discovers
 * `db/migrate/<version>_<name>.ts` itself, the same way `trails db migrate`
 * does, so the suite exercises the migrations rather than a hand-written
 * schema that could drift from them.
 */
export async function migrateScratchDatabase(): Promise<void> {
  const path = await getPathAsync();
  await Base.establishConnection({ adapter: "sqlite3", database: ":memory:", pool: 1 });
  await new MigrationContext([path.resolve(cwd(), "db", "migrate")]).migrate();
}
