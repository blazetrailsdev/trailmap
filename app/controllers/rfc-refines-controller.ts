import { ApiController } from "./api-controller.ts";
import { presentParam } from "./concerns/api-params.ts";
import { Rfc } from "../models/rfc.ts";
import { RfcRefine } from "../models/rfc-refine.ts";

/**
 * `POST /rfc-refines` — a refine agent's report, the payload
 * `scripts/rfc-refine-done.sh` sends: `{kind: "rfc-refine", id, outcome,
 * summary}`. `id` is the RFC's. ringo took the same body on `/cleanup-pane`
 * and kept it in `refines.json`; here it is a row the RFC page's Refinements
 * tab reads.
 *
 * Loopback only, like the rest of the API. An unknown RFC is a 404, a kind
 * other than `rfc-refine` a 400, and an outcome outside the three a 422.
 */
export class RfcRefinesController extends ApiController {
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
    const refine = new RfcRefine({
      rfc_id: rfcId,
      outcome: presentParam(this.params, "outcome") ?? "",
      summary: String(this.params.get("summary") ?? ""),
    });
    if (!(await refine.save())) {
      await this.render({ json: { error: refine.errors.fullMessages.join(", ") }, status: 422 });
      return;
    }
    await this.render({ json: { id: refine.id, rfc: rfcId, outcome: refine.outcome }, status: 201 });
  }
}
