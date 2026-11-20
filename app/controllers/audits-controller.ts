import { htmlSafe } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.ts";
import { Audit } from "../models/audit.ts";
import { renderMarkdown } from "../helpers/markdown-helper.ts";
import { stripFrontmatter } from "../models/concerns/document.ts";

/**
 * `/audits` — the agent-written progress reports, newest first;
 * `/audits/<file>`, the list with one of them open; and
 * `/audits/<file>/raw`, one report on its own. Ported from ringo's
 * `webhook/audits.go`; ringo's `/audits/view/<file>` redirects to `raw`.
 *
 * The filename is checked by the route (config/audit-files.ts), so a bad name
 * never reaches an action, and a well-formed one naming no audit is
 * `RecordNotFound`, a 404 — ringo answers the first with a 400; Rails does not
 * tell the two apart.
 *
 * The open report has a fullscreen toggle (`audits.js`), as ringo's does.
 *
 * Read-only, and audits only: ringo's page also lists grade report cards and
 * RFC refinements, and carries the "Generate report card" trigger. The cards
 * read `stats.db`, which RFC 0136 leaves Go-owned, so those stay on ringo.
 */
export class AuditsController extends ApplicationController {
  /** The list, with the newest audit open. */
  async index(): Promise<void> {
    const audits = await Audit.newestFirst().toArray();
    await this._renderPage(audits, audits[0] ?? null);
  }

  /** The list, with this audit open. */
  async show(): Promise<void> {
    const audit = await Audit.find(String(this.params.get("id")));
    await this._renderPage(await Audit.newestFirst().toArray(), audit, "index");
  }

  /**
   * One audit on its own: markdown in the audit shell, an `.html` submission
   * exactly as the agent wrote it.
   */
  async raw(): Promise<void> {
    const audit = await Audit.find(String(this.params.get("id")));
    const source = await audit.read();
    this.response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    // An audit is agent-written and served from trailmap's own origin. An
    // `.html` report is a self-contained document whose charts and toggles
    // are scripts, as ringo serves it, so scripts run — but `sandbox` without
    // `allow-same-origin` gives the document an opaque origin, framed or on
    // its own: it reads no cookie or storage of this origin, and a POST it
    // makes carries `Origin: null`: forgery protection refuses it on a page,
    // and LoopbackOnly refuses any write carrying an Origin on the
    // forgery-exempt loopback API (concerns/loopback-only.ts). ringo
    // serves it same-origin to bind its fullscreen key in the frame; this
    // deliberately does not copy that.
    this.response.setHeader("Content-Security-Policy", "sandbox allow-scripts");
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
  private async _renderPage(audits: Audit[], selected: Audit | null, action?: string): Promise<void> {
    const body =
      selected === null || selected.isHtml()
        ? null
        : renderMarkdown(stripFrontmatter(await selected.read()));
    await this.render({
      ...(action ? { action } : {}),
      locals: { audits, selected, body },
    });
  }
}
