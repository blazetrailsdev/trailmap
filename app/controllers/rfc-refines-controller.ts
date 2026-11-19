import { include } from "@blazetrails/activesupport";
import { StringIO } from "@blazetrails/ruby-compat";
import { ApiController } from "./api-controller.ts";
import { IngestToken } from "./concerns/ingest-token.ts";
import { presentParam } from "./concerns/api-params.ts";
import { Rfc } from "../models/rfc.ts";
import { Refinement } from "../models/refinement.ts";
import { Story } from "../models/story.ts";

/**
 * `POST /rfc-refines` — a refine agent's report, the payload
 * `scripts/rfc-refine-done.sh` sends: `{kind: "rfc-refine", id, outcome,
 * summary}`. `id` is the RFC's. ringo took the same body on `/cleanup-pane`
 * and kept it in `refines.json`; here it is a `Refinement`, its summary
 * attached as `text/markdown` and `stories` the RFC's story count now. An
 * optional `when` becomes `created_at`, for the import of ringo's history.
 *
 * Loopback only, like the rest of the API, and it needs the ingest bearer
 * token (IngestToken). An unknown RFC is a 404, a kind
 * other than `rfc-refine` a 400, and an outcome outside the three, a summary
 * that is not a string, or a `when` that is not a time, a 422.
 */
/** What the Rails twin's `Time.iso8601` accepts: a date, a time and a zone. */
const ISO8601 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/;

export class RfcRefinesController extends ApiController {
  static {
    include(this, IngestToken);
  }

  async create(): Promise<void> {
    const kind = presentParam(this.params, "kind") ?? "rfc-refine";
    if (kind !== "rfc-refine") {
      await this.render({ json: { error: `unsupported kind "${kind}"` }, status: 400 });
      return;
    }
    const rfcId = presentParam(this.params, "id") ?? "";
    if ((await Rfc.findBy({ id: rfcId })) === null) {
      await this.render({ json: { error: `no RFC "${rfcId}"` }, status: 404 });
      return;
    }
    const summary = this.params.get("summary") ?? "";
    if (typeof summary !== "string") {
      await this.render({ json: { error: "summary must be a string" }, status: 422 });
      return;
    }
    const when = presentParam(this.params, "when");
    if (when !== undefined && (!ISO8601.test(when) || Number.isNaN(Date.parse(when)))) {
      await this.render({ json: { error: "when must be a time" }, status: 422 });
      return;
    }
    const refine = new Refinement({
      rfc_id: rfcId,
      outcome: presentParam(this.params, "outcome") ?? "",
      stories: await Story.where({ rfc_id: rfcId }).count(),
      ...(when === undefined ? {} : { created_at: new Date(when) }),
    });
    if (!(await refine.save())) {
      await this.render({ json: { error: refine.errors.fullMessages.join(", ") }, status: 422 });
      return;
    }
    await refine.summary.attach({ io: new StringIO(summary), filename: "summary.md", contentType: "text/markdown" });
    await this.render({ json: { id: refine.id, rfc: rfcId, outcome: refine.outcome }, status: 201 });
  }
}
