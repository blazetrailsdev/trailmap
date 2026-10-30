import type { Rfc, Story } from "../models/index.ts";
import { shownStoryStatus } from "../models/concerns/effective-status.ts";
import { markTitle, type RfcMark } from "../models/concerns/rfc-marks.ts";
import {
  rfcStalled,
  rfcStoryCounts,
  rfcTerminal,
  storyBarLength,
  storyStatusCounts,
  type RfcStoryCounts,
  type StatusCount,
  type StoryBarLength,
} from "../models/concerns/rfc-progress.ts";
import { daysSince } from "../models/concerns/elapsed.ts";

/** One story on an RFC's show page. */
export interface RfcStoryRow {
  id: string;
  title: string;
  /**
   * The EFFECTIVE status, not the authored one: a `ready` story under a
   * non-active RFC is a `draft` (`effectiveStoryStatus`), which is what ringo
   * shows and what `orderStoriesForRfc` ranks this row by. Showing the
   * authored status here would have the page sort a story as a draft while
   * labelling it ready, and would tell a reader it is claimable when the
   * queue will not offer it.
   */
  status: string;
  estLoc: number | null;
  cluster: string | null;
  priority: number | null;
}

/** One row of the RFC list. */
export interface RfcRow {
  id: string;
  title: string;
  owner: string | null;
  priority: number | null;
  supersededBy: string | null;
  clusters: string[];
  counts: RfcStoryCounts;
  bar: StatusCount[];
  /** How long the bar is drawn: its story count against every RFC's. */
  barLength: StoryBarLength;
  /** Active, with nothing ready or in flight: `rfcStalled`. */
  stalled: boolean;
  /** The bar's history, as positions along its track. */
  ticks: { kind: string; pct: number; title: string }[];
  storyTotal: number;
  /** Days since the RFC was written, or null when it is terminal or undated. */
  openDays: number | null;
}

export function rfcStoryRow(story: Story, rfcStatus: string, held: Set<string>): RfcStoryRow {
  return {
    id: story.id,
    title: story.title ?? story.id,
    status: shownStoryStatus(rfcStatus, story.status, held.has(story.id)) ?? "",
    estLoc: story.est_loc,
    cluster: story.cluster,
    priority: story.priority,
  };
}

export function rfcListRow(
  rfc: Rfc,
  own: (string | null)[],
  held: boolean[] | undefined,
  marks: RfcMark[],
  barScale: number,
): RfcRow {
  const barLength = storyBarLength(own.length, barScale);
  return {
    id: rfc.id,
    title: rfc.title ?? rfc.id,
    owner: rfc.owner,
    priority: rfc.priority,
    supersededBy: rfc.superseded_by,
    clusters: rfc.clusters,
    counts: rfcStoryCounts(own),
    bar: storyStatusCounts(own, rfc.status, held),
    barLength,
    stalled: rfcStalled(rfc.status, own),
    // A tick at the bar's own end says nothing and smears the tip.
    ticks: marks
      .filter((mark) => mark.count > 0)
      .map((mark) => ({
        kind: mark.kind,
        pct: storyBarLength(mark.count, barScale).pct,
        title: markTitle(mark),
      }))
      .filter((tick) => Math.abs(tick.pct - barLength.pct) >= 0.5),
    storyTotal: own.length,
    openDays: rfcTerminal(rfc.status) ? null : daysSince(rfc.created_on),
  };
}

export const RfcPagesHelper = { rfcStoryRow, rfcListRow };
