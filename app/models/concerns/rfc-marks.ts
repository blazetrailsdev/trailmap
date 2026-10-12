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
 * Not carried: ringo also folds in its own record of refine reports
 * (`mergeRefineHistory`), which is the loop's local state and is not here.
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
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? at.slice(0, 10) : new Date(ms).toISOString().slice(0, 10);
}

/** `events` in the order they happened. */
export function collectRfcMarks(
  known: ReadonlySet<string>,
  storyRfc: ReadonlyMap<string, string>,
  events: readonly MarkEvent[],
): Map<string, RfcMark[]> {
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  const created = new Set(events.filter((e) => e.verb === "new").map((e) => e.storyId));
  const baseline = new Map<string, number>();
  for (const [id, rfc] of storyRfc) if (!created.has(id) && known.has(rfc)) bump(baseline, rfc);

  const running = new Map(baseline);
  const firstDay = new Map<string, string>();
  const firstBurst = new Map<string, number>();
  const refines = new Map<string, RfcMark[]>();
  for (const e of events) {
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

  const out = new Map<string, RfcMark[]>();
  for (const rfc of known) {
    const count = baseline.get(rfc) || firstBurst.get(rfc) || 0;
    const later = refines.get(rfc) ?? [];
    if (count === 0 && later.length === 0) continue;
    out.set(rfc, [{ at: null, count, kind: "origin", reps: 1 }, ...later]);
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
