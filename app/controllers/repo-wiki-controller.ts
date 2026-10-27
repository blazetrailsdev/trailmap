import { RepoController } from "./repo-controller.ts";
import { Rfc } from "../models/rfc.ts";
import { storiesForRepo } from "../models/concerns/repo-scope.ts";
import { readDocument } from "../models/concerns/document.ts";
import { renderMarkdown } from "../helpers/markdown-helper.ts";

/**
 * `/:owner/:repo/wiki` — the prose behind this repo's work.
 *
 * The wiki of this domain is the content tree: every RFC is a document, and
 * `tasks ingest` records where each one lives (`rfcs.file_path`). So the index
 * is the RFCs whose work touches this repository, and the page body is the one
 * named by `?page=<rfc-id>`, rendered through the same markdown helper the RFC
 * show page uses — the one gated against ringo's renderer.
 *
 * It reads the content tree from disk (`readDocument`, `TASKS_DIR`), which is
 * the one thing on these tabs that is not a database row. A process with no
 * tasks checkout gets the index and an explanatory error instead of a body,
 * which is what `readDocument` returns rather than raising.
 */
export class RepoWikiController extends RepoController {
  static tab = "wiki";

  async index(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const rfcIds = new Set(stories.map((story) => story.rfc_id));
    const pages = (await Rfc.all().toArray())
      .filter((rfc) => rfcIds.has(rfc.id))
      .map((rfc) => ({
        id: rfc.id,
        title: rfc.title ?? rfc.id,
        status: rfc.status,
        href: `/${this.repo.nameWithOwner()}/wiki?page=${rfc.id}`,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

    const requested = String(this.params.get("page") ?? "");
    const selected = pages.some((page) => page.id === requested) ? requested : null;
    const rfc = selected === null ? null : await Rfc.findBy({ id: selected });
    const doc = rfc === null ? null : await readDocument(rfc.file_path);

    await this.render({
      locals: this.repoLocals({
        pages,
        selected,
        pageTitle: rfc === null ? null : (rfc.title ?? rfc.id),
        body: doc === null || doc.markdown === "" ? null : renderMarkdown(doc.markdown),
        error: doc?.error ?? "",
      }),
    });
  }
}
