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

  /** `orDash`. */
  orDash(s: string | undefined): string {
    return s ? s : "—";
  },
};
