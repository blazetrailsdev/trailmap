import { Hub } from "./hub.ts";

/** What a refine pass can report, as `rfc-refine-done.sh` sends it. */
export const RFC_REFINE_OUTCOMES = ["changed", "no-change", "aborted"] as const;

/**
 * One refine report: an RFC-refine agent's summary of a pass over an RFC's
 * stories (kind=rfc-refine). The RFC page's Refinements tab shows the newest
 * and lists the rest; ringo kept only the newest, in `refines.json`.
 *
 * `rfc_id` is the task domain's RFC id, a string: nothing joins across the
 * two databases.
 */
export class RfcRefine extends Hub {
  static {
    this.validates("rfc_id", { presence: true });
    this.validates("outcome", { inclusion: { in: [...RFC_REFINE_OUTCOMES] } });
  }

  /** An RFC's reports, newest first. */
  static forRfc(rfcId: string) {
    return this.where({ rfc_id: rfcId }).order({ created_at: "desc", id: "desc" });
  }
}
