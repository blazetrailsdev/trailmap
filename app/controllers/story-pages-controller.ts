import type { SafeBuffer } from "@blazetrails/activesupport";
import { ApplicationController } from "./application-controller.js";
import { Rfc, Story, StoryDep, StoryPackage, StoryRfcDep } from "../models/index.js";
import { jsonArrayColumn } from "../models/rfc.js";
import { readDocument } from "../models/concerns/document.js";
import { renderMarkdown } from "../helpers/markdown-helper.js";
import {
  BACKLOG_FILTERS,
  isBacklogFilter,
  matchesBacklogFilter,
  orderBacklog,
  type BacklogFilter,
} from "../models/concerns/backlog.js";
import { daysSince } from "../models/concerns/elapsed.js";

/** The tab captions, which are not all the filter's own name. */
const BACKLOG_TAB_LABELS: Record<BacklogFilter, string> = {
  open: "Open",
  done: "Closed",
  ready: "Ready",
  draft: "Draft",
  blocked: "Blocked",
  icebox: "Icebox",
};

/** One row of the backlog list, assembled in the controller — a `.tse` cannot. */
export interface BacklogRow {
  id: string;
  title: string;
  status: string;
  rfcId: string;
  estLoc: number | null;
  cluster: string | null;
  assignee: string | null;
  /**
   * The PR number, shown as `#N` linking to the story page rather than out to
   * GitHub. That is ringo's own link (webhook/backlog.go:292, btwebooks
   * `7897c57`) and it is deliberate on both sides: the
   * database stores a bare integer, and nothing in it names the repo — a
   * story's PR can be against trails, trailmap or tasks, so there is no host
   * or owner/name to build a GitHub URL from without guessing one. The story
   * page is the page that does know, and it is one hop from here.
   */
  pr: number | null;
  /** 0-based place in the ready queue, or null when the queue does not hold it. */
  queuePos: number | null;
  priority: number | null;
  priorityInherited: boolean;
  packages: string[];
  packagesInherited: boolean;
  icebox: boolean;
  staleDays: number | null;
}

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
  /**
   * `/backlog` — the story list, server-rendered.
   *
   * Like `/rfcs`, ringo prints a shell and assembles this in the browser from
   * `/spawnloop/backlog` (`HandleBacklogPage`, webhook/spawnloop.go:2642), so
   * the port is of `draw()`: the tab predicates, the ordering, the queue
   * positions and the effective priority/packages labels. The tabs become
   * links (`/backlog?filter=ready`) for the reason given on the RFC list.
   *
   * The queue is `Story.claimable()`, NOT a second ranking written for this
   * page. It is the port `pnpm gate` proves byte-identical to the CLI, and a
   * page that ordered the queue its own way would be advertising a pick order
   * no agent actually follows.
   *
   * Left behind: the refine button (a write, and ringo's own dispatch), the
   * loop-enabled indicator and the over-LOC label. The last is not an
   * omission of taste — the ceiling is `sl.cfg.MaxLOC`, ringo's own
   * configuration, and it is not in this database to read.
   */
  async index(): Promise<void> {
    const index = await Story.rankingIndex();
    const [queue, rfcs] = await Promise.all([
      Story.claimable({ index }),
      Rfc.all().toArray(),
    ]);

    const rfcPackages = new Map(rfcs.map((rfc) => [rfc.id, jsonArrayColumn(rfc.packages)]));
    const queuePos = new Map(queue.map((story, at) => [story.id, at]));

    const requested = String(this.params.get("filter") ?? "");
    const filter: BacklogFilter = isBacklogFilter(requested) ? requested : "open";

    // Every tab count comes from the SAME predicate that fills its list, so a
    // tab can never advertise a number its own list does not hold — ringo's
    // rule, which it applies to Open, Draft and Icebox and to which the other
    // three are equivalent (their predicate is an exact status match).
    const tabs = BACKLOG_FILTERS.map((key) => ({
      key,
      label: BACKLOG_TAB_LABELS[key],
      count: index.stories.filter((s) => matchesBacklogFilter(s, key, index.rfcStatus)).length,
      href: `/backlog?filter=${key}`,
      active: key === filter,
    }));

    const shown = orderBacklog(
      index.stories.filter((s) => matchesBacklogFilter(s, filter, index.rfcStatus)),
      queuePos,
    );

    this.render({
      template: "story-pages/index",
      locals: {
        filter,
        tabs,
        queueSize: queue.length,
        showQueueHelp: filter === "open" || filter === "ready",
        rows: shown.map((story): BacklogRow => {
          const own = index.packages.get(story.id) ?? [];
          const packagesInherited = own.length === 0;
          // Effective priority and effective packages, both own-then-parent:
          // the number the ready queue actually ranks by is
          // `effectivePriority`, so showing the story's bare `priority` would
          // contradict the queue this very page is ordered by.
          const inheritedPriority = index.rfcPriority.get(story.rfc_id);
          const priorityInherited = story.priority === null && inheritedPriority !== undefined;
          return {
            id: story.id,
            title: story.title ?? story.id,
            status: story.status,
            rfcId: story.rfc_id,
            estLoc: story.est_loc,
            cluster: story.cluster,
            assignee: story.assignee,
            pr: story.pr,
            queuePos: queuePos.get(story.id) ?? null,
            priority: story.priority ?? inheritedPriority ?? null,
            priorityInherited,
            packages: packagesInherited ? (rfcPackages.get(story.rfc_id) ?? []) : own,
            packagesInherited,
            // The Icebox TAB's own predicate, not a copy of it. Spelling the
            // rule out here as `iceboxed(...) && status !== "done"` was the
            // same two clauses in a second place, and the module exists so
            // this rule has exactly one home — the label a row wears and the
            // tab that would collect it cannot now disagree about what iced
            // means.
            icebox: matchesBacklogFilter(story, "icebox", index.rfcStatus),
            staleDays: daysSince(story.updated_on),
          };
        }),
      },
    });
  }

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
      packages = jsonArrayColumn(rfc.packages);
      inherited = packages.length > 0;
    }

    // The dep statuses and the document are independent of each other, and the
    // document read is disk. Issued together so the page costs one round of
    // waiting rather than three.
    const [deps, rfcDeps, doc] = await Promise.all([
      statusesFor(Story, depRows.map((row) => row.depends_on_id)),
      statusesFor(Rfc, rfcDepRows.map((row) => row.rfc_id)),
      readDocument(story.file_path),
    ]);

    this.renderPage(
      {
        id,
        story,
        rfc,
        deps,
        rfcDeps,
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
