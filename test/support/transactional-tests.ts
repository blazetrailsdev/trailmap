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
