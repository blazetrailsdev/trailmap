/**
 * Whole days between a stored date stamp and now.
 *
 * The list pages both age a record — the RFC list shows how long an RFC has
 * been open (`created_on`), the backlog shows how long a story has gone
 * untouched (`updated_on`) — and both read a column `ingest` copies out of
 * markdown, which is date-only ("2026-09-06") for stories and sometimes a full
 * ISO datetime for RFCs. `parseUpdated` (`webhook/spawnloop.go:2565`) accepts
 * either, and so does this: `Date.parse` reads both, and an unparseable or
 * absent stamp yields null rather than a NaN that renders as "NaNd ago".
 *
 * Truncated, and floored at zero: Go computes `int(now.Sub(t).Hours() / 24)`
 * and clamps a negative to 0, so a stamp dated tomorrow reads "0d" on both.
 */
export function daysSince(stamp: string | null, now: number = Date.now()): number | null {
  if (!stamp) return null;
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.trunc((now - at) / 86_400_000));
}
