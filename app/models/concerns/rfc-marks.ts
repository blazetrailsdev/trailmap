/**
 * The history ticks on an RFC's story bar: how many stories it held when it
 * was written, and at each refinement. Ported from ringo's `collectRFCMarks`
 * (`webhook/rfcmarks.go`), which reconstructs them from the same event stream
 * this database holds:
 *
 * - `new` is the only verb that changes an RFC's story COUNT. `done` and
 *   `close` leave the story filed under the RFC, and the bar counts them.
 * - a `spawn` naming an RFC and no story is a refinement dispatch.
 *
 * A story with no `new` event predates the log and is the baseline. An RFC
 * with no baseline started at its first day's burst of `new`s.
 *
 * The stored refine reports are folded in as ringo's `mergeRefineHistory`
 * (rfcmarks.go:371) folds its own. A hub report records no story count, so its
 * count is the RFC's running count at the report's time.
 */
export interface RfcMark {
  /** Null for the origin mark. */
  at: string | null;
  count: number;
  kind: "origin" | "refine";
  /** How many consecutive refinements found this same count. */
  reps: number;
}

export interface MarkEvent {
  at: string;
  verb: string;
  storyId: string | null;
  rfcId: string | null;
  detail: string | null;
}

/** One stored refine report, as `rfc_refines` holds it. */
export interface RefineReport {
  at: string;
  rfcId: string;
}

/** A report within this of a reconstructed refinement is that refinement (rfcmarks.go:47). */
const REFINE_WINDOW_MS = 6 * 60 * 60 * 1000;

const REFINE_SOURCES: readonly string[] = ["rfc-refine", "rfc-refine-auto"];

function spawnSource(detail: string | null): string {
  try {
    const parsed = JSON.parse(detail ?? "");
    return String(parsed?.source || parsed?.arg || "");
  } catch {
    return "";
  }
}

/** The UTC day, as ringo's `rfcMarkDay` (rfcmarks.go:304): `at` carries offsets. */
function utcDay(at: string): string {
  // RFC 3339 only, as Go's parse is: anything else would be read as local time.
  if (!/^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(at)) return at.slice(0, 10);
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at.slice(0, 10) : new Date(ms).toISOString().slice(0, 10);
}

/** RFC 3339 at second precision, as Go's `time.RFC3339` and Ruby's `iso8601` write it. */
function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Origin first, then on the `at` string, stable, as ringo's `collapseRFCMarks`
 * sorts (rfcmarks.go:341); consecutive refinements at one count are one tick.
 */
function collapseRfcMarks(marks: RfcMark[]): RfcMark[] {
  const key = (m: RfcMark) => (m.kind === "origin" ? "" : (m.at ?? ""));
  const sorted = [...marks].sort((a, b) => {
    if ((a.kind === "origin") !== (b.kind === "origin")) return a.kind === "origin" ? -1 : 1;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  const out: RfcMark[] = [];
  for (const m of sorted) {
    const last = out.at(-1);
    if (last && m.kind === "refine" && last.kind === "refine" && last.count === m.count) last.reps += m.reps;
    else out.push({ ...m });
  }
  return out;
}

/** A report replaces the count of the nearest refinement in the window, else is its own tick. */
function mergeRefineHistory(marks: RfcMark[], history: readonly { at: string; count: number }[]): RfcMark[] {
  const out = marks.map((m) => ({ ...m }));
  for (const rep of history) {
    const when = Date.parse(rep.at);
    if (rep.count <= 0 || Number.isNaN(when)) continue;
    let best = -1;
    let bestGap = 0;
    out.forEach((m, i) => {
      if (m.kind !== "refine") return;
      const t = Date.parse(m.at ?? "");
      if (Number.isNaN(t)) return;
      const gap = Math.abs(when - t);
      if (gap <= REFINE_WINDOW_MS && (best < 0 || gap < bestGap)) [best, bestGap] = [i, gap];
    });
    if (best >= 0) out[best]!.count = rep.count;
    else out.push({ at: isoSeconds(when), count: rep.count, kind: "refine", reps: 1 });
  }
  return collapseRfcMarks(out);
}

/** `events` in the order they happened; `reports` in any order. */
export function collectRfcMarks(
  known: ReadonlySet<string>,
  storyRfc: ReadonlyMap<string, string>,
  events: readonly MarkEvent[],
  reports: readonly RefineReport[] = [],
): Map<string, RfcMark[]> {
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  const created = new Set(events.filter((e) => e.verb === "new").map((e) => e.storyId));
  const baseline = new Map<string, number>();
  for (const [id, rfc] of storyRfc) if (!created.has(id) && known.has(rfc)) bump(baseline, rfc);

  const running = new Map(baseline);
  const firstDay = new Map<string, string>();
  const firstBurst = new Map<string, number>();
  const refines = new Map<string, RfcMark[]>();
  // An unparseable report is dropped; an unparseable event drains nothing, as
  // if it were at the epoch (the Rails twin passes `Time.at(0)`).
  const pending = reports
    .map((r) => ({ ...r, ms: Date.parse(r.at) }))
    .filter((r) => known.has(r.rfcId) && !Number.isNaN(r.ms))
    .sort((a, b) => a.ms - b.ms);
  const history = new Map<string, { at: string; count: number }[]>();
  const recordUntil = (at: number) => {
    while (pending.length > 0 && pending[0]!.ms < at) {
      const r = pending.shift()!;
      history.set(r.rfcId, [...(history.get(r.rfcId) ?? []), { at: r.at, count: running.get(r.rfcId) ?? 0 }]);
    }
  };
  for (const e of events) {
    const eventMs = Date.parse(e.at);
    recordUntil(Number.isNaN(eventMs) ? 0 : eventMs);
    const viaStory = e.storyId === null ? undefined : storyRfc.get(e.storyId);
    const rfc = viaStory !== undefined && known.has(viaStory) ? viaStory : e.rfcId;
    if (rfc === null || !known.has(rfc)) continue;
    if (e.verb === "new") {
      bump(running, rfc);
      const day = utcDay(e.at);
      if (!firstDay.has(rfc)) firstDay.set(rfc, day);
      if (firstDay.get(rfc) === day) bump(firstBurst, rfc);
    } else if (e.verb === "spawn" && !e.storyId) {
      const source = spawnSource(e.detail);
      // A spawn with no readable source IS counted, as in ringo
      // (rfcmarks.go:254): only the RFC-refine paths spawn against an RFC.
      if (source !== "" && !REFINE_SOURCES.includes(source)) continue;
      const marks = refines.get(rfc) ?? [];
      const count = running.get(rfc) ?? 0;
      const last = marks.at(-1);
      if (last?.count === count) last.reps++;
      else marks.push({ at: e.at, count, kind: "refine", reps: 1 });
      refines.set(rfc, marks);
    }
  }

  recordUntil(Infinity);

  const out = new Map<string, RfcMark[]>();
  for (const rfc of known) {
    const count = baseline.get(rfc) || firstBurst.get(rfc) || 0;
    const later = refines.get(rfc) ?? [];
    const reported = history.get(rfc) ?? [];
    if (count === 0 && later.length === 0 && reported.length === 0) continue;
    const marks: RfcMark[] = [{ at: null, count, kind: "origin", reps: 1 }, ...later];
    out.set(rfc, reported.length > 0 ? mergeRefineHistory(marks, reported) : marks);
  }
  return out;
}

/** What a tick is, in words, since a 2px line cannot say. */
export function markTitle(mark: RfcMark): string {
  const n = `${mark.count} ${mark.count === 1 ? "story" : "stories"}`;
  if (mark.kind === "origin") return `${n} when the RFC was written`;
  const reps = mark.reps > 1 ? ` (${mark.reps} refinements, unchanged)` : "";
  return `${n} at refinement on ${mark.at?.slice(0, 10)}${reps}`;
}

/**
 * `RfcMarks`, the constant Zeitwerk requires this file to define (RFC 0213): a Ruby
 * module of `module_function`s, bundling the named exports above.
 */
export const RfcMarks = {
  collectRfcMarks,
  markTitle,
};
