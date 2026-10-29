import type { Transcript, TranscriptToolCall } from "../../lib/ringo-core.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The archive pages' formatting, each one ringo's helper of the same name (`webhook/sessionarchive_page.go`). */
export const SessionsHelper = {
  /**
   * Go's `Jan 2 15:04` of an RFC 3339 time as ringo marshalled it: the wall
   * clock in the offset ringo wrote, which is ringo's local zone, so the cell
   * reads as ringo's does whatever zone trailmap runs in.
   */
  sessionTime(at: string): string {
    const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(at);
    return m ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])} ${m[3]}:${m[4]}` : at;
  },

  /** `shortDur`: `<1m`, `42m`, `3h05m`. */
  shortDur(ms: number): string {
    if (ms < 60_000) return "<1m";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor(ms / 60_000) % 60;
    return h === 0 ? `${m}m` : `${h}h${String(m).padStart(2, "0")}m`;
  },

  /** `money`: a dash for nothing, else dollars to the cent. */
  money(v: number): string {
    return v === 0 ? "—" : `$${v.toFixed(2)}`;
  },

  /** `humanBytes`. */
  humanBytes(n: number): string {
    if (n >= 2 ** 30) return `${(n / 2 ** 30).toFixed(1)} GB`;
    if (n >= 2 ** 20) return `${(n / 2 ** 20).toFixed(1)} MB`;
    if (n >= 2 ** 10) return `${(n / 2 ** 10).toFixed(1)} KB`;
    return `${n} B`;
  },

  /** `shortID`. */
  shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 12)}…` : id;
  },

  /** Go's `15:04:05` of an RFC 3339 time, in the offset it was written in. Empty for Go's zero time. */
  clock(at: string): string {
    return at.startsWith("0001-") ? "" : at.slice(11, 19);
  },

  /** `ToolCall.Duration`, in ms: zero when the call never answered. */
  callMs(call: TranscriptToolCall): number {
    if (call.StartedAt.startsWith("0001-") || call.EndedAt.startsWith("0001-")) return 0;
    return Math.max(0, Date.parse(call.EndedAt) - Date.parse(call.StartedAt));
  },

  /** `Transcript.Duration`, in ms. */
  wallMs(tr: Transcript): number {
    return Date.parse(tr.LastAt) - Date.parse(tr.FirstAt);
  },

  /** `toolDur`: `30ms`, `1.5s`, `10m00s`; empty for nothing. */
  toolDur(ms: number): string {
    if (ms <= 0) return "";
    if (ms < 1000) return `${Math.trunc(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.trunc(ms / 60_000)}m${String(Math.trunc(ms / 1000) % 60).padStart(2, "0")}s`;
  },

  /** `clip`: the first `max` BYTES, as Go slices, and how much was left out. */
  clip(s: string, max: number): string {
    const bytes = new TextEncoder().encode(s);
    if (bytes.length <= max) return s;
    return `${new TextDecoder().decode(bytes.subarray(0, max))}\n… clipped, ${SessionsHelper.humanBytes(bytes.length - max)} more`;
  },

  /** `core.FirstLine`: the first line, at most 96 bytes, with " …" when cut. */
  firstLine(s: string): string {
    let cut = false;
    const nl = s.indexOf("\n");
    if (nl >= 0) [s, cut] = [s.slice(0, nl), true];
    s = s.trim();
    const bytes = new TextEncoder().encode(s);
    if (bytes.length > 96) [s, cut] = [new TextDecoder().decode(bytes.subarray(0, 96)).trim(), true];
    return cut ? `${s} …` : s;
  },

  /** `len(s)` in Go: bytes, not UTF-16 units. */
  byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
  },

  /** `plural`. */
  plural(n: number, one: string, many: string): string {
    return n === 1 ? one : many;
  },

  /** `prFromCWD(cwd) > 0`: a session run from a review checkout reviewed the PR. */
  reviewedFrom(cwd: string): boolean {
    const m = /review[^/]*\/(?:[^/]+\/)*pr-(\d+)(?:\/|$)/i.exec(cwd);
    return m !== null && Number(m[1]) > 0;
  },

  /** `orDash`. */
  orDash(s: string | undefined): string {
    return s ? s : "—";
  },
};
