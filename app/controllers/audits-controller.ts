import { htmlSafe } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.js";
import { AUDIT_FILE_RE, auditTitle, auditsDir, isHtmlAudit, listAudits, readAudit } from "../models/audit.js";
import { renderMarkdown } from "../helpers/markdown-helper.js";
import { stripFrontmatter } from "../models/concerns/document.js";

/**
 * `/audits` — the agent-written progress reports, newest first, and
 * `/audits/view/<file>`, one of them. Ported from ringo's `webhook/audits.go`.
 *
 * Read-only, and audits only: ringo's page also lists grade report cards and
 * RFC refinements, and carries the "Generate report card" trigger. The cards
 * read `stats.db`, which RFC 0136 leaves Go-owned, so those stay on ringo.
 */
export class AuditsController extends ApplicationController {
  async index(): Promise<void> {
    const audits = await listAudits();
    const requested = String(this.params.get("file") ?? "");
    const selected = audits.find((audit) => audit.name === requested) ?? audits[0] ?? null;
    await this.render({ locals: { audits, selected, configured: auditsDir() !== null } });
  }

  /**
   * One audit. Markdown is rendered into the audit shell; an `.html`
   * submission is served exactly as the agent wrote it. The name is checked
   * against ringo's `auditFileRe` BEFORE anything touches the filesystem, and
   * with ringo's answers: 400 for a bad name, 404 for a missing file.
   */
  async show(): Promise<void> {
    const name = String(this.params.get("file") ?? "");
    if (!AUDIT_FILE_RE.test(name)) {
      await this.render({ plain: "bad audit name", status: 400 });
      return;
    }
    const source = await readAudit(name);
    if (source === null) {
      await this.render({ plain: "audit not found", status: 404 });
      return;
    }
    this.response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    // An audit is agent-written and served from trailmap's own origin, so a
    // script in one could call every state-changing endpoint here. `sandbox`
    // gives the document an opaque origin and no scripts, opened in the
    // page's iframe or on its own. ringo does NOT do this — it reaches into
    // the frame to bind its fullscreen key — and this deliberately does not
    // copy that.
    this.response.setHeader("Content-Security-Policy", "sandbox");
    if (isHtmlAudit(name)) {
      await this.render({ html: htmlSafe(source), layout: false });
      return;
    }
    await this.render({
      layout: false,
      locals: { title: auditTitle(name), body: renderMarkdown(stripFrontmatter(source)) },
    });
  }
}
