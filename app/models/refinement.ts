import { type Extended } from "@blazetrails/activesupport";
import type { ClassMethods } from "@blazetrails/activestorage/attached/model";
import type { One } from "@blazetrails/activestorage/attached/one";
import { ApplicationRecord } from "./application-record.ts";

/** What a refine pass can report, as `rfc-refine-done.sh` sends it. */
export const RFC_REFINE_OUTCOMES = ["changed", "no-change", "aborted"] as const;

/**
 * One refine report: an RFC-refine agent's summary of a pass over an RFC's
 * stories (kind=rfc-refine). The RFC page's Refinements tab shows the newest
 * and lists the rest; ringo kept only the newest, in `refines.json`.
 *
 * On `Base`, with the summary in Active Storage (RFC 0243, Decision 1).
 * `stories` is the RFC's story count when the report landed, as ringo's
 * `refineHistoryEntry.Stories`; null for a report that never recorded one.
 */
export class Refinement extends ApplicationRecord {
  declare summary: One;

  static {
    (this as unknown as Extended<typeof ClassMethods>).hasOneAttached("summary");
    this.validates("rfc_id", { presence: true });
    this.validates("outcome", { inclusion: { in: [...RFC_REFINE_OUTCOMES] } });
  }

  /** An RFC's reports, newest first. */
  static forRfc(rfcId: string) {
    return this.where({ rfc_id: rfcId }).order({ created_at: "desc", id: "desc" });
  }
}
