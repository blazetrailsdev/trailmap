import { ArgumentError, include, presence, zone, type TimeZone } from "@blazetrails/activesupport";
import { StringIO } from "@blazetrails/ruby-compat";
import { ApiController } from "./api-controller.ts";
import { IngestToken } from "./concerns/ingest-token.ts";
import { presentParam } from "./concerns/api-params.ts";
import { Audit } from "../models/audit.ts";

const CONTENT_TYPES: Record<string, string> = { md: "text/markdown", html: "text/html" };

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
 * an empty body or a `writtenAt` that is not a time is a 422. Loopback only,
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
    await audit.save();
    await this.render({ json: { id: audit.toParam(), url: `/audits/${audit.toParam()}` }, status: 201 });
  }
}
