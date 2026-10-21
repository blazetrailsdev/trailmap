import { htmlSafe } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.js";
import { AUDIT_FILE_RE, Audit, auditsDir } from "../models/audit.js";
import { renderMarkdown } from "../helpers/markdown-helper.js";
import { stripFrontmatter } from "../models/concerns/document.js";

/**
 * `/audits` — the agent-written progress reports, newest first;
 * `/audits/<file>`, the list with one of them open; and
 * `/audits/view/<file>`, one report on its own. Ported from ringo's
 * `webhook/audits.go`.
 *
 * Read-only, and audits only: ringo's page also lists grade report cards and
 * RFC refinements, and carries the "Generate report card" trigger. The cards
 * read `stats.db`, which RFC 0136 leaves Go-owned, so those stay on ringo.
 */
export class AuditsController extends ApplicationController {
  /**
   * A name the list does not hold raises `RecordNotFound`, a 404, rather than
   * quietly opening the newest, so a stale link says it is stale.
   *
   * A markdown audit renders INLINE, through the same escaping renderer the
   * story pages use. An `.html` audit is a self-contained document with its
   * own styles and possibly scripts, so it is never inlined into this origin:
   * it stays in a sandboxed frame, and `body` is null.
   */
  async index(): Promise<void> {
    const audits = await Audit.all();
    const file = this.params.get("file");
    const selected =
      file === undefined || file === null ? (audits[0] ?? null) : await Audit.find(String(file));
    const body =
      selected === null || selected.isHtml()
        ? null
        : renderMarkdown(stripFrontmatter(await selected.read()));
    await this.render({ locals: { audits, selected, body, configured: auditsDir() !== null } });
  }

  /**
   * One audit. Markdown is rendered into the audit shell; an `.html`
   * submission is served exactly as the agent wrote it. The name is checked
   * against ringo's `auditFileRe` BEFORE anything touches the filesystem, with
   * ringo's 400 for a bad name; a missing file is `RecordNotFound`, a 404.
   */
  async show(): Promise<void> {
    const name = this.auditName();
    if (!AUDIT_FILE_RE.test(name)) {
      await this.render({ plain: "bad audit name", status: 400 });
      return;
    }
    const audit = await Audit.find(name);
    const source = await audit.read();
    this.response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    // An audit is agent-written and served from trailmap's own origin, so a
    // script in one could call every state-changing endpoint here. `sandbox`
    // gives the document an opaque origin and no scripts, opened in the
    // page's iframe or on its own. ringo does NOT do this — it reaches into
    // the frame to bind its fullscreen key — and this deliberately does not
    // copy that.
    this.response.setHeader("Content-Security-Policy", "sandbox");
    if (audit.isHtml()) {
      await this.render({ html: htmlSafe(source), layout: false });
      return;
    }
    await this.render({
      layout: false,
      locals: { title: audit.title, body: renderMarkdown(stripFrontmatter(source)) },
    });
  }

  /**
   * The filename, through strong parameters: Rails 8's `params.expect(:file)`,
   * which permits only a scalar and raises `ParameterMissing` (a 400) for
   * anything else. `:file` is a path segment, so routing already makes it one
   * string; `AUDIT_FILE_RE` in `show` is still what decides it may be served.
   */
  private auditName(): string {
    return String(this.params.expect("file"));
  }
}
