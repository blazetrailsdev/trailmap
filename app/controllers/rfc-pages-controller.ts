import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.js";
import { Rfc, Story } from "../models/index.js";
import { readDocument } from "../models/concerns/document.js";
import { orderStoriesForRfc, rfcStoryCounts } from "../models/concerns/rfc-progress.js";
import { renderMarkdown } from "../helpers/markdown-helper.js";

/**
 * `/rfc/<id>` — the RFC show page.
 *
 * One of the first two pages trailmap serves from real data, and a port of
 * ringo's `HandleRFCPage` (`webhook/rfcs.go:174`): the RFC's metadata, its
 * stories with a done count, and its rendered markdown. ringo keeps serving
 * its own copy until this one is verified against it, so nothing here
 * replaces anything yet.
 *
 * What is deliberately NOT ported: the action buttons (refine, sunset, spawn
 * a batch), the refinements tab and the charts tab. Every one of them is
 * ringo's own local state or a write, and this story is the read.
 *
 * A missing RFC renders the page with a 404 rather than an error page — same
 * as ringo, and it is what makes a stale link say which id it was looking for.
 */
export class RfcPagesController extends ApplicationController {
  async show(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const rfc = id === "" ? null : await Rfc.findBy({ id });
    if (rfc === null) {
      this.renderPage({ id, rfc: null, stories: [], counts: null }, 404);
      return;
    }

    const stories = orderStoriesForRfc(await Story.where({ rfc_id: id }).toArray());
    const doc = await readDocument(rfc.file_path);
    this.renderPage(
      {
        id,
        rfc,
        stories,
        counts: rfcStoryCounts(stories),
        body: doc.markdown === "" ? null : renderMarkdown(doc.markdown),
        error: doc.error,
      },
      200,
    );
  }

  /**
   * The template is named rather than inferred. The view directory is
   * kebab-case here, as every other one in `app/views` is, while the
   * controller path the implicit lookup derives is `rfc_pages`.
   */
  private renderPage(locals: Record<string, unknown>, status: number): void {
    this.render({
      template: "rfc-pages/show",
      locals: { body: null as SafeBuffer | null, error: "", ...locals },
      status,
    });
  }
}
