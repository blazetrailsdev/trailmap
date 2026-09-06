import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.js";
import { Rfc, Story, StoryDep, StoryPackage, StoryRfcDep } from "../models/index.js";
import { readDocument } from "../models/concerns/document.js";
import { renderMarkdown } from "../helpers/markdown-helper.js";

/** One dependency and the status that decides whether it still gates. */
export interface DepRow {
  id: string;
  /** "" when the id resolves to nothing — an unknown dep, not a satisfied one. */
  status: string;
}

/**
 * `/story/<id>` — the story show page, ported from ringo's `HandleStoryPage`
 * (`webhook/story.go:100`).
 *
 * The metadata, the deps with the statuses that gate them, and the rendered
 * markdown. Left behind with the same reasoning as the RFC page: the action
 * buttons, the PR body, the event log and the spawn history are ringo's
 * local artifacts or writes, and this story is the read.
 *
 * Packages fall back to the parent RFC's when the story declares none, which
 * is what ringo does (`webhook/story.go:161`) and what the ready queue
 * assumes — a story with no `packages:` inherits its RFC's, so showing an
 * empty list here would contradict the queue.
 */
export class StoryPagesController extends ApplicationController {
  async show(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const story = id === "" ? null : await Story.findBy({ id });
    if (story === null) {
      this.renderPage(
        { id, story: null, rfc: null, deps: [], rfcDeps: [], packages: [], inherited: false },
        404,
      );
      return;
    }

    const [rfc, depRows, rfcDepRows, packageRows] = await Promise.all([
      Rfc.findBy({ id: story.rfc_id }),
      StoryDep.where({ story_id: id }).toArray(),
      StoryRfcDep.where({ story_id: id }).toArray(),
      StoryPackage.where({ story_id: id }).toArray(),
    ]);

    let packages = packageRows.map((row) => row.package);
    let inherited = false;
    if (packages.length === 0 && rfc !== null) {
      packages = parseJsonArray(rfc.packages);
      inherited = packages.length > 0;
    }

    const doc = await readDocument(story.file_path);
    this.renderPage(
      {
        id,
        story,
        rfc,
        deps: await statusesFor(Story, depRows.map((row) => row.depends_on_id)),
        rfcDeps: await statusesFor(Rfc, rfcDepRows.map((row) => row.rfc_id)),
        packages,
        inherited,
        body: doc.markdown === "" ? null : renderMarkdown(doc.markdown),
        error: doc.error,
      },
      200,
    );
  }

  /** Named for the same reason as the RFC page's — see `renderPage` there. */
  private renderPage(locals: Record<string, unknown>, status: number): void {
    this.render({
      template: "story-pages/show",
      locals: { body: null as SafeBuffer | null, error: "", ...locals },
      status,
    });
  }
}

/**
 * `ids` paired with their statuses, in the order given. One query for the
 * batch: a dep list is short, but the page has two of them and a per-id find
 * turns a link list into a query loop.
 */
async function statusesFor(
  model: typeof Story | typeof Rfc,
  ids: string[],
): Promise<DepRow[]> {
  if (ids.length === 0) return [];
  const found = new Map<string, string>();
  for (const record of await model.where({ id: ids }).toArray()) {
    found.set(record.id, String(record.status ?? ""));
  }
  return ids.map((id) => ({ id, status: found.get(id) ?? "" }));
}

/** A stored JSON array column, or `[]` for null and for anything unparseable. */
function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
