import { describe as describedClass } from "@blazetrails/activesupport/testing/autorun";

/**
 * Rails' `self.use_transactional_tests = false`, on a test case class.
 *
 * `useTransactionalTests` is the class attribute `TestFixtures` defines when
 * test-help includes it, and it works at runtime. Its TYPE is missing:
 * trailties' test-help augments `TestCase` with the fixtures class methods but
 * not this attribute, so assigning it does not typecheck. That gap is a trails
 * defect, tracked as `test-help-types-use-transactional-tests`; this one cast
 * is the only place trailmap works around it, and goes when that lands.
 */
export function withoutTransactionalTests(testCase: object): void {
  (testCase as { useTransactionalTests: boolean }).useTransactionalTests = false;
}

/**
 * A test case that loads no fixtures: Rails' `fixtures :all` is inherited, and
 * a case outside the fixture transaction would load them for real, deleting
 * every row of each fixture table. Both kinds of opt-out want this:
 *
 * - a file that sets `use_transactional_tests = false` points `Base` at a
 *   database of its own, or holds a lock or a pool that the transaction would
 *   change, and the task-domain fixtures are not its data;
 * - `controllerTestCase`'s nested case runs INSIDE a test that already holds
 *   the fixtures, and reloading them would wipe the rows that test created.
 *
 * The same cast as above, for the same missing types.
 */
export function withoutFixtures(testCase: object): void {
  const fixtured = testCase as { fixtureTableNames: string[]; fixtureSets: Record<string, string> };
  fixtured.fixtureTableNames = [];
  fixtured.fixtureSets = {};
}

/**
 * `withoutFixtures` for the class of one vitest `describe` block, which
 * test-help's autorun makes a subclass of the file's case. Pass it to that
 * block's `beforeAll`, which vitest calls with the suite:
 *
 *     beforeAll(withoutFixturesIn);
 *
 * For a block that points `Base` at a database the fixtures are not for, such
 * as the live `tasks.db` the gate job ingests: loading them there would
 * replace its `rfcs` rows with the fixtures' for every test in the block.
 */
export function withoutFixturesIn(suite: Parameters<typeof describedClass>[0]): void {
  withoutFixtures(describedClass(suite));
}
