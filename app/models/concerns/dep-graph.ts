import { Rfc } from "../rfc.ts";
import { StoryDep } from "../joins.ts";
import { Story } from "../story.ts";
import { shownStoryStatus } from "./effective-status.ts";

/** One story reached from the page's own, and how far away it is. */
export interface DepNode {
  id: string;
  title: string | null;
  /** The EFFECTIVE status; "" when the id resolves to no story. */
  status: string;
  /** 1 for a direct dependency or dependent, 2 for one of theirs, and so on. */
  depth: number;
  /** The story this one was first reached through; null at depth 1. */
  via: string | null;
}

export interface DepGraph {
  /** Everything the story waits on, nearest first. */
  blockedBy: DepNode[];
  /** Everything that waits on the story, nearest first. */
  blocks: DepNode[];
  /** Whether following the deps from this story leads back to it. */
  cyclic: boolean;
}

type Direction = "blockedBy" | "blocks";
interface Reached {
  id: string;
  story: Story | null;
  depth: number;
  via: string | null;
}

/**
 * Breadth-first over `story_deps`, ONE ROUND PER LEVEL: each round asks for
 * every edge leaving the whole frontier and has the framework preload the
 * stories at the far end (`includes`), so a level costs two queries however
 * many stories are on it. A walk that called `story.deps` on each node would
 * cost a query a node, and the graph under a wide RFC is hundreds of nodes.
 *
 * `seen` is what ends it. An id is expanded once, so a cycle is walked round
 * exactly once and then has nothing new to offer; ingest refuses cycles
 * (`checkDepGraph`), but a page must not hang on a database that has one.
 */
async function walk(start: string, direction: Direction): Promise<{ reached: Reached[]; cyclic: boolean }> {
  const seen = new Set([start]);
  const reached: Reached[] = [];
  let cyclic = false;
  let frontier = [start];
  for (let depth = 1; frontier.length > 0; depth += 1) {
    // Rowid order within a level, for the reason the story page gives: it is
    // the order the frontmatter listed the deps in.
    const edges =
      direction === "blockedBy"
        ? await StoryDep.where({ story_id: frontier }).includes("dependsOn").order({ rowid: "asc" }).toArray()
        : await StoryDep.where({ depends_on_id: frontier }).includes("story").order({ rowid: "asc" }).toArray();
    const next: string[] = [];
    for (const edge of edges) {
      const [from, id, story] =
        direction === "blockedBy"
          ? [edge.story_id, edge.depends_on_id, edge.dependsOn]
          : [edge.depends_on_id, edge.story_id, edge.story];
      if (id === start) cyclic = true;
      if (seen.has(id)) continue;
      seen.add(id);
      reached.push({ id, story: story ?? null, depth, via: depth === 1 ? null : from });
      next.push(id);
    }
    frontier = next;
  }
  return { reached, cyclic };
}

/**
 * What `id` blocks and what blocks it, transitively.
 *
 * Statuses are effective ones, as everywhere else (`shared/_status-badge`), so
 * the parent RFCs of every story reached are read too — once, for both
 * directions.
 */
export async function depGraphFor(id: string): Promise<DepGraph> {
  const [up, down] = await Promise.all([walk(id, "blockedBy"), walk(id, "blocks")]);

  const rfcIds = new Set<string>();
  for (const { story } of [...up.reached, ...down.reached]) if (story !== null) rfcIds.add(story.rfc_id);
  const rfcStatus = new Map<string, string | null>();
  const held = await Story.depHeldIds([...up.reached, ...down.reached].map((r) => r.id));
  if (rfcIds.size > 0) {
    for (const rfc of await Rfc.where({ id: [...rfcIds] }).toArray()) rfcStatus.set(rfc.id, rfc.status);
  }

  const node = ({ id: nodeId, story, depth, via }: Reached): DepNode => ({
    id: nodeId,
    title: story?.title ?? null,
    status:
      story === null
        ? ""
        : String(shownStoryStatus(rfcStatus.get(story.rfc_id) ?? null, story.status, held.has(story.id)) ?? ""),
    depth,
    via,
  });
  return {
    blockedBy: up.reached.map(node),
    blocks: down.reached.map(node),
    cyclic: up.cyclic,
  };
}
