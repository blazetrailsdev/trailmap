import { ArgumentError, include, presence, zone, type TimeZone } from "@blazetrails/activesupport";
import { StringIO } from "@blazetrails/ruby-compat";
import { ApiController } from "./api-controller.ts";
import { IngestToken } from "./concerns/ingest-token.ts";
import { presentParam } from "./concerns/api-params.ts";
import { RecordNotUnique } from "@blazetrails/activerecord";
import { Audit, CONTENT_TYPES } from "../models/audit.ts";

/**
 * `POST /audits` — an audit agent's report, replacing the file trails'
 * `.claude/skills/audit-report/run.sh` wrote: `{slug, repo, body}`, with an
 * optional `format` (`md`, the default, or `html`), `title` and `writtenAt`
 * (now, to the second, when absent). The body is attached as
 * `<slug>-<stamp>.<format>`, and the answer is 201 `{id, url}`, `id` the
 * filename `toParam` gives.
 *
 * An audit already stored for the same `(repo, slug, writtenAt)` answers 200
 * with its id, so the import can be run again. A bad slug, an unknown format,
 * an empty body or a `writtenAt` that is not a time is a 422, as is a missing
 * repo. A concurrent import that loses the race to the unique index answers
 * 200 with the winner's id. Loopback only,
 * and it needs the ingest bearer token (IngestToken).
 */
export class AuditReportsController extends ApiController {
  static {
    include(this, IngestToken);
  }

  async create(): Promise<void> {
    const body = this.params.get("body") ?? "";
    if (typeof body !== "string" || body === "") {
      await this.render({ json: { error: "body must be a non-empty string" }, status: 422 });
      return;
    }
    const writtenAtParam = presentParam(this.params, "writtenAt");
    let writtenAt;
    try {
      writtenAt =
        writtenAtParam !== undefined ? (zone() as TimeZone).iso8601(writtenAtParam) : (zone() as TimeZone).now().change({ usec: 0 });
    } catch (e) {
      if (!(e instanceof ArgumentError)) throw e;
      await this.render({ json: { error: "writtenAt must be a time" }, status: 422 });
      return;
    }
    const slug = presentParam(this.params, "slug") ?? "";
    const repo = presentParam(this.params, "repo") ?? "";
    // Required here, not on the model: audits imported before #179 carry none.
    if (repo === "") {
      await this.render({ json: { error: "repo must be given" }, status: 422 });
      return;
    }
    const existing = await Audit.findBy({ repo, slug, written_at: writtenAt });
    if (existing !== null) {
      await this.render({ json: { id: existing.toParam(), url: `/audits/${existing.toParam()}` }, status: 200 });
      return;
    }
    // The body's, not `params`': the route's `format: "json"` default outranks it there.
    const format = String(presence(this.request.requestParameters.format) ?? "md");
    const audit = new Audit({
      slug,
      repo,
      format,
      title: presentParam(this.params, "title") ?? null,
      written_at: writtenAt,
    });
    if (!(await audit.isValid())) {
      await this.render({ json: { error: audit.errors.fullMessages.join(", ") }, status: 422 });
      return;
    }
    await audit.setBody({ io: new StringIO(body), filename: audit.toParam(), contentType: CONTENT_TYPES[format] });
    try {
      await audit.saveBang();
    } catch (e) {
      if (!(e instanceof RecordNotUnique)) throw e;
      const winner = await Audit.findBy({ repo, slug, written_at: writtenAt });
      if (winner === null) throw e;
      await this.render({ json: { id: winner.toParam(), url: `/audits/${winner.toParam()}` }, status: 200 });
      return;
    }
    await this.render({ json: { id: audit.toParam(), url: `/audits/${audit.toParam()}` }, status: 201 });
  }
}
