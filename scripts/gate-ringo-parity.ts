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
 * Why it cannot vendor ringo's code the way the list gate does: the list pages
 * assemble in the browser, so their logic is JavaScript and can be executed
 * here. This page's logic is Go and its SQL, so the only way to run ringo's
 * version is to ask ringo. That makes this gate need a RUNNING ringo, which is
 * why it is not in CI and not in `pnpm gate` — it is a local check, run
 * against the box that has both the stats database and the container.
 *
 *     RINGO_BASE=http://10.200.0.48:8080 TRAILMAP_BASE=http://127.0.0.1:4567 \
 *       pnpm tsx scripts/gate-ringo-parity.ts
 *
 * Compared: the offered metric list, each metric's gap columns, the package
 * list, the refusals, and every series point — date, PR, percent, matched,
 * total and each gap count. A difference in any of them is a difference in
 * what the page would draw.
 */

import { env, exit } from "@blazetrails/ruby-compat";

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

for (const query of CASES) {
  const name = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const [theirs, mine] = await Promise.all([
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
    for (let i = 0; i < n; i += 1) {
      check(`[${name}] ${k} point ${i}`, myOne.points[i], theirOne.points[i]);
    }
  }
}

if (failures.length > 0) {
  console.error(`gate-ringo-parity: ${failures.length} difference(s) from ringo\n`);
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  exit(1);
}
console.log(`gate-ringo-parity: ${CASES.length} cases agree with ringo, point for point`);
