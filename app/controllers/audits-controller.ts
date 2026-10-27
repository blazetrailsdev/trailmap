import { htmlSafe } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { Audit, auditsDir } from "../models/audit.ts";
import { renderMarkdown } from "../helpers/markdown-helper.ts";
import { stripFrontmatter } from "../models/concerns/document.ts";

/**
 * `/audits` — the agent-written progress reports, newest first;
 * `/audits/<file>`, the list with one of them open; and
 * `/audits/<file>/raw`, one report on its own. Ported from ringo's
 * `webhook/audits.go`; ringo's `/audits/view/<file>` redirects to `raw`.
 *
 * The filename is checked by the route (config/audit-files.ts), so a bad name
 * never reaches an action, and a well-formed one with no file is
 * `RecordNotFound`, a 404 — ringo answers the first with a 400; Rails does not
 * tell the two apart.
 *
 * Read-only, and audits only: ringo's page also lists grade report cards and
 * RFC refinements, and carries the "Generate report card" trigger. The cards
 * read `stats.db`, which RFC 0136 leaves Go-owned, so those stay on ringo.
 */
export class AuditsController extends ApplicationController {
  /** The list, with the newest audit open. */
  async index(): Promise<void> {
    const audits = await Audit.all();
    await this.renderPage(audits, audits[0] ?? null);
  }

  /** The list, with this audit open. */
  async show(): Promise<void> {
    const audit = await Audit.find(String(this.params.get("id")));
    await this.renderPage(await Audit.all(), audit, "index");
  }

  /**
   * One audit on its own: markdown in the audit shell, an `.html` submission
   * exactly as the agent wrote it.
   */
  async raw(): Promise<void> {
    const audit = await Audit.find(String(this.params.get("id")));
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
   * A markdown audit renders INLINE, through the same escaping renderer the
   * story pages use. An `.html` audit is a self-contained document with its
   * own styles and possibly scripts, so it is never inlined into this origin:
   * it stays in a sandboxed frame on `raw`, and `body` is null.
   */
  private async renderPage(audits: Audit[], selected: Audit | null, action?: string): Promise<void> {
    const body =
      selected === null || selected.isHtml()
        ? null
        : renderMarkdown(stripFrontmatter(await selected.read()));
    await this.render({
      ...(action ? { action } : {}),
      locals: { audits, selected, body, configured: auditsDir() !== null },
    });
  }
}
