import { SafeBuffer, htmlEscape, htmlSafe } from "@blazetrails/activesupport";
import type { Story } from "../models/story.ts";
import type { RankedStory, RankingIndex } from "../models/concerns/ranking.ts";
import {
  matchesBacklogFilter,
  type BacklogStory,
} from "../models/concerns/backlog.ts";
import { daysSince } from "../models/concerns/elapsed.ts";

/** The GitHub organization every `repo#N` PR ref names a repo in. */
export const GITHUB_ORG_URL = "https://github.com/blazetrailsdev";

/** A PR ref as the tasks database writes `stories.pr`: `repo#N`. */
const PR_REF = /^([A-Za-z0-9_.-]+)#([0-9]+)$/;

/** One row of the backlog list. */
export interface BacklogRow {
  id: string;
  title: string;
  status: string;
  rfcId: string;
  /**
   * The row prints it only when it is non-zero: ringo's backlog draws the
   * estimate under `if (s.est_loc)`, so an authored `est-loc: 0` reads the
   * same as none.
   */
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
  /** `repo#N`, e.g. `trails#7228`. */
  pr: string | null;
  /** 0-based place in the ready queue, or null when the queue does not hold it. */
  queuePos: number | null;
  priority: number | null;
  priorityInherited: boolean;
  packages: string[];
  packagesInherited: boolean;
  icebox: boolean;
  staleDays: number | null;
}

/**
 * The backlog row for `story`, read off the ranking outline the page is
 * ordered by.
 */
export function backlogRow(
  story: Story,
  listing: BacklogStory,
  index: RankingIndex<RankedStory>,
  rfcPackages: ReadonlyMap<string, string[]>,
  queuePos: ReadonlyMap<string, number>,
): BacklogRow {
  const own = index.packages.get(story.id) ?? [];
  const packagesInherited = own.length === 0;
  // Effective priority and effective packages, both own-then-parent:
  // the number the ready queue actually ranks by is
  // `effectivePriority`, so showing the story's bare `priority` would
  // contradict the queue this very page is ordered by.
  const inheritedPriority = index.rfcPriority.get(story.rfc_id);
  const priorityInherited =
    story.priority === null && inheritedPriority !== undefined;
  return {
    id: story.id,
    title: story.title ?? story.id,
    status: listing.status,
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
    icebox: matchesBacklogFilter(listing, "icebox", index.rfcStatus),
    staleDays: daysSince(story.updated_on),
  };
}

export const StoryPagesHelper = {
  backlogRow,

  /**
   * The GitHub URL of a story's `repo#N` PR, or null when the value is not a
   * ref the page can link (a legacy bare number); the page then prints it as
   * text. Rails' `pr_url` has the same shape.
   */
  prUrl(pr: string): string | null {
    const m = PR_REF.exec(pr);
    return m ? `${GITHUB_ORG_URL}/${m[1]}/pull/${m[2]}` : null;
  },

  /** The PR as the story page shows it: a link when it is a ref, else escaped text. Rails' `pr_link`. */
  prLink(pr: string): SafeBuffer {
    const url = StoryPagesHelper.prUrl(pr);
    const text = htmlEscape(pr);
    return htmlSafe(
      url === null
        ? String(text)
        : `<a target="_blank" rel="noopener" href="${htmlEscape(url)}">${text}</a>`,
    );
  },
};
