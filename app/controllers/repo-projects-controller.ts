import { RepoController } from "./repo-controller.js";
import { Rfc } from "../models/rfc.js";
import { Story } from "../models/story.js";
import { storiesForRepo } from "../models/concerns/repo-scope.js";
import { rfcStoryCounts, storyStatusCounts } from "../models/concerns/rfc-progress.js";

/**
 * `/:owner/:repo/projects` — the RFCs this repo's work belongs to.
 *
 * An RFC is this domain's project board: a body of work with a status, an
 * owner, and a set of stories that are done or not. So the project rows here
 * are RFCs, narrowed to the ones that have at least one story scoped to this
 * repository, with the same done/total counts the RFC pages use —
 * `rfcStoryCounts` decides that figure everywhere, so an RFC cannot report
 * 12/20 here and 12/21 on `/rfcs`.
 *
 * The counts are the RFC's OWN totals, not the repo's slice of them: a project
 * is finished when the project is finished, and a board that said 3/4 because
 * one repo happens to hold four of its forty stories would be wrong in a way
 * that is hard to notice.
 */
export class RepoProjectsController extends RepoController {
  static tab = "projects";

  async index(): Promise<void> {
    const stories = await storiesForRepo(this.repo.name);
    const rfcIds = new Set(stories.map((story) => story.rfc_id));
    const rfcs = (await Rfc.all().toArray()).filter((rfc) => rfcIds.has(rfc.id));

    // One pluck for every RFC's statuses, rather than loading each RFC's
    // stories — the same reason `/rfcs` plucks two columns.
    const statuses = await storyStatusesByRfc();

    await this.render({
      locals: this.repoLocals({
        rows: rfcs
          .map((rfc) => {
            const own = statuses.get(rfc.id) ?? [];
            return {
              id: rfc.id,
              title: rfc.title ?? rfc.id,
              status: rfc.status,
              priority: rfc.priority,
              counts: rfcStoryCounts(own),
              bar: storyStatusCounts(own, rfc.status),
              mine: stories.filter((story) => story.rfc_id === rfc.id).length,
            };
          })
          .sort(
            (a, b) =>
              (a.priority ?? 1_000_000) - (b.priority ?? 1_000_000) || a.id.localeCompare(b.id),
          ),
      }),
    });
  }

  /** `/:owner/:repo/projects/<rfc-id>` — one board, its stories by status. */
  async show(): Promise<void> {
    const id = String(this.params.get("id") ?? "");
    const rfc = id === "" ? null : await Rfc.findBy({ id });
    const mine = (await storiesForRepo(this.repo.name)).filter((story) => story.rfc_id === id);

    await this.render({
      locals: this.repoLocals({
        id,
        rfc,
        columns: columnsOf(mine),
      }),
      status: rfc === null ? 404 : 200,
    });
  }
}

/** Every story's status, grouped by RFC — two columns, not 11,000 records. */
async function storyStatusesByRfc(): Promise<Map<string, string[]>> {
  const rows = await Story.pluck("rfc_id", "status");
  const byRfc = new Map<string, string[]>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [rfcId, status] = row;
    const bucket = byRfc.get(String(rfcId));
    if (bucket) bucket.push(String(status));
    else byRfc.set(String(rfcId), [String(status)]);
  }
  return byRfc;
}

/** The board's columns: a story list per status, in lifecycle order. */
function columnsOf(
  stories: Array<{ id: string; title: string | null; status: string }>,
): Array<{ status: string; stories: Array<{ id: string; title: string }> }> {
  const order = ["ready", "claimed", "in-progress", "done", "blocked", "closed", "draft"];
  return order
    .map((status) => ({
      status,
      stories: stories
        .filter((story) => story.status === status)
        .map((story) => ({ id: story.id, title: story.title ?? story.id })),
    }))
    .filter((column) => column.stories.length > 0);
}
