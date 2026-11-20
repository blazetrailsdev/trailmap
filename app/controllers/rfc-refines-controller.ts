import { ArgumentError, include, zone, type TimeZone } from "@blazetrails/activesupport";
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
 * optional `when` becomes `created_at`, and an optional numeric `stories`
 * the count, for the import of ringo's history (scripts/import-reports.ts); a
 * report already stored for the same `(rfc, when)` answers 200 with its id, so
 * the import can be run again.
 *
 * Loopback only, like the rest of the API, and it needs the ingest bearer
 * token (IngestToken). An unknown RFC is a 404, a kind
 * other than `rfc-refine` a 400, and an outcome outside the three, a summary
 * that is not a string, or a `when` that is not a time, a 422.
 */
export class RfcRefinesController extends ApiController {
  static {
    include(this, IngestToken);
    this.skipBeforeAction(":_requireIngestToken", { only: ["index"] });
  }

  /**
   * `GET /rfc-refines` — every refine report, oldest first, without its
   * summary: what ringo's RFC index draws its bar's ticks from (`mergeRefineHistory`).
   * `?rfc=<id>` narrows it to one RFC. A read, so it needs no ingest token.
   */
  async index(): Promise<void> {
    const rfcId = presentParam(this.params, "rfc");
    const scope = rfcId === undefined ? Refinement.all() : Refinement.where({ rfc_id: rfcId });
    const refines = await scope.order({ created_at: "asc", id: "asc" }).toArray();
    await this.render({
      json: refines.map((r) => ({
        id: r.id,
        rfc: r.rfc_id,
        when: r.created_at.utc().iso8601(),
        outcome: r.outcome,
        stories: r.stories,
      })),
    });
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
    let createdAt = null;
    try {
      if (when !== undefined) createdAt = (zone() as TimeZone).iso8601(when);
    } catch (e) {
      if (!(e instanceof ArgumentError)) throw e;
      await this.render({ json: { error: "when must be a time" }, status: 422 });
      return;
    }
    if (createdAt !== null) {
      const existing = await Refinement.findBy({ rfc_id: rfcId, created_at: createdAt });
      if (existing !== null) {
        await this.render({ json: { id: existing.id, rfc: rfcId, outcome: existing.outcome }, status: 200 });
        return;
      }
    }
    const stories = this.params.get("stories");
    const refine = new Refinement({
      rfc_id: rfcId,
      outcome: presentParam(this.params, "outcome") ?? "",
      stories: typeof stories === "number" ? stories : await Story.where({ rfc_id: rfcId }).count(),
      created_at: createdAt,
    });
    await refine.setSummary({ io: new StringIO(summary), filename: "summary.md", contentType: "text/markdown" });
    if (!(await refine.save())) {
      await this.render({ json: { error: refine.errors.fullMessages.join(", ") }, status: 422 });
      return;
    }
    await this.render({ json: { id: refine.id, rfc: rfcId, outcome: refine.outcome }, status: 201 });
  }
}
