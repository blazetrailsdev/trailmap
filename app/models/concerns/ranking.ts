/**
 * Ready-queue ranking and bundle packing.
 *
 * PORTED VERBATIM from the CLI's src/ranking.ts. Keeping the functions
 * identical is what makes the equivalence gate hold BY CONSTRUCTION: the same
 * functions over an equivalent index produce identical output, so moving the
 * queue onto the models cannot silently reorder anyone's work queue.
 *
 * They stay pure functions over a loaded snapshot; `Story`'s class methods do
 * the loading and delegate here. Imports from `../story.js` are TYPE-ONLY, so
 * this module can be imported by the model it ranks without a cycle.
 *
 * The deliberate rename survives the move: the queue is `claimable()`, not
 * `ready()` — the `enum` already generates a `Story.ready()` meaning only
 * `status = 'ready'`. Conflating them would hand agents unclaimable stories.
 */
import { effectiveStoryStatus } from "./effective-status.js";
import type { Story } from "../story.js";

/** A snapshot of everything the queue reads, loaded once per query. */
export interface RankingIndex {
  stories: Story[];
  rfcStatus: ReadonlyMap<string, string>;
  rfcPriority: ReadonlyMap<string, number>;
  deps: ReadonlyMap<string, string[]>;
  rfcDeps: ReadonlyMap<string, string[]>;
  paths: ReadonlyMap<string, string[]>;
  // Read by the serializer, not by the ranking itself: the published index
  // carries a story's packages, and loading them here is what lets one snapshot
  // answer a whole request instead of the queue and the serializer each
  // scanning the join tables.
  packages: ReadonlyMap<string, string[]>;
}

export interface PriorityContext {
  rfcPriority: ReadonlyMap<string, number>;
  remaining: ReadonlyMap<string, number>;
}

/**
 * A dep is satisfied when `done` OR `closed`: a closed story will never ship,
 * but it will also never block — treating it as resolved is what keeps a
 * dependent from being stranded forever.
 */
export function isDepResolved(status: string | null | undefined): boolean {
  return status === "done" || status === "closed";
}

export function effectivePriority(
  story: Story,
  rfcPriority: ReadonlyMap<string, number>,
): number {
  return story.priority ?? rfcPriority.get(story.rfc_id) ?? Infinity;
}

function remainingStoryCounts(index: RankingIndex): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of index.stories) {
    if (isDepResolved(s.status)) continue;
    m.set(s.rfc_id, (m.get(s.rfc_id) ?? 0) + 1);
  }
  return m;
}

export function priorityContext(index: RankingIndex): PriorityContext {
  return { rfcPriority: index.rfcPriority, remaining: remainingStoryCounts(index) };
}

export function comparePriority(a: Story, b: Story, ctx: PriorityContext): number {
  const ea = effectivePriority(a, ctx.rfcPriority);
  const eb = effectivePriority(b, ctx.rfcPriority);
  if (ea !== eb) return ea < eb ? -1 : 1;
  const pa = ctx.rfcPriority.get(a.rfc_id);
  const pb = ctx.rfcPriority.get(b.rfc_id);
  if (pa === undefined || pa !== pb) return 0;
  const ra = ctx.remaining.get(a.rfc_id) ?? 0;
  const rb = ctx.remaining.get(b.rfc_id) ?? 0;
  return ra === rb ? 0 : ra - rb;
}

export function claimableIn(index: RankingIndex, opts: { rfc?: string } = {}): Story[] {
  const ctx = priorityContext(index);
  const storyStatus = new Map(index.stories.map((s) => [s.id, s.status as string]));
  return (
    index.stories
      .filter((s) => {
        // Both claimability gates in one call: `effectiveStoryStatus` folds
        // the story's authored status together with its parent RFC's, so a
        // `ready` story under a draft RFC (or under an RFC absent from the
        // snapshot) comes back as `draft` and is filtered out here. Asking the
        // shared rule rather than re-testing `rfcStatus === "active"` is what
        // keeps the queue and the published index from disagreeing.
        if (effectiveStoryStatus(index.rfcStatus.get(s.rfc_id), s.status) !== "ready") return false;
        if (opts.rfc && s.rfc_id !== opts.rfc) return false;
        if ((index.deps.get(s.id) ?? []).some((d) => !isDepResolved(storyStatus.get(d)))) {
          return false;
        }
        if ((index.rfcDeps.get(s.id) ?? []).some((d) => index.rfcStatus.get(d) !== "closed")) {
          return false;
        }
        return true;
      })
      // Lower N first; unprioritized last. Array.sort is stable, so ties —
      // including the all-unprioritized common case — keep index order.
      .sort((a, b) => comparePriority(a, b, ctx))
  );
}

// 0/1 knapsack: max total est_loc within budget. N <= a few dozen in
// practice; O(N*budget) is trivially fast.
export function bestBundle(items: Story[], budget: number): Story[] {
  const n = items.length;
  if (n === 0 || budget <= 0) return [];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(budget + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const cost = items[i - 1].est_loc ?? 0;
    for (let b = 0; b <= budget; b++) {
      dp[i][b] = dp[i - 1][b];
      if (cost > 0 && cost <= b) {
        dp[i][b] = Math.max(dp[i][b], dp[i - 1][b - cost] + cost);
      }
    }
  }
  const chosen: Story[] = [];
  let b = budget;
  for (let i = n; i >= 1; i--) {
    if (dp[i][b] !== dp[i - 1][b]) {
      chosen.push(items[i - 1]);
      b -= items[i - 1].est_loc ?? 0;
    }
  }
  return chosen.reverse();
}

export function bundleScope(
  index: RankingIndex,
  opts: { cluster?: string; rfc?: string },
): Story[] {
  return claimableIn(index, { rfc: opts.rfc }).filter((s) =>
    opts.cluster ? s.cluster === opts.cluster : true,
  );
}

export type EmptyBundleReason = "no-matching-stories" | "none-within-budget";

export function emptyBundleReasonIn(
  index: RankingIndex,
  opts: { cluster?: string; rfc?: string },
): EmptyBundleReason {
  return bundleScope(index, opts).length === 0 ? "no-matching-stories" : "none-within-budget";
}

export function nextBundleIn(
  index: RankingIndex,
  opts: { maxLoc: number; cluster?: string; rfc?: string },
): Story[] {
  const inScope = bundleScope(index, opts);
  // Priority overrides cluster-LOC packing: any prioritized story outranks
  // every unprioritized one, however well the latter fills the budget. The
  // head is the globally-highest-priority candidate (claimableIn already
  // sorted, and `.filter()` preserves order); the rest of the budget is filled
  // from that story's cluster. A prioritized story leads even with no est_loc
  // — the missing-estimate exclusion is only for the knapsack path below.
  const ctx = priorityContext(index);
  const prioritized = inScope.filter((s) => effectivePriority(s, ctx.rfcPriority) !== Infinity);
  if (prioritized.length > 0) {
    const lead = prioritized[0];
    const leadLoc = lead.est_loc ?? 0;
    const rest = inScope.filter(
      (s) => s.id !== lead.id && s.cluster === lead.cluster && s.est_loc !== null,
    );
    const fill = bestBundle(rest, opts.maxLoc - leadLoc).sort((a, b) => comparePriority(a, b, ctx));
    return [lead, ...fill];
  }
  // Unprioritized path: knapsack same-cluster stories by est_loc, so stories
  // without an estimate can't be packed and are excluded here.
  const candidates = inScope.filter((s) => s.est_loc !== null);
  // Map<string | null, ...> so `null` (unclustered) stays distinct from any
  // real cluster name, even one literally called "_none".
  const byCluster = new Map<string | null, Story[]>();
  for (const s of candidates) {
    const bucket = byCluster.get(s.cluster) ?? [];
    bucket.push(s);
    byCluster.set(s.cluster, bucket);
  }
  let best: Story[] = [];
  let bestTotal = 0;
  for (const group of byCluster.values()) {
    const subset = bestBundle(group, opts.maxLoc);
    const total = subset.reduce((a, s) => a + (s.est_loc ?? 0), 0);
    if (total > bestTotal) {
      best = subset;
      bestTotal = total;
    }
  }
  return best;
}

export function summarizeBundle(
  rows: Story[],
  maxLoc: number,
): { total: number; leadExceedsBudget: boolean } {
  const total = rows.reduce((a, s) => a + (s.est_loc ?? 0), 0);
  return { total, leadExceedsBudget: total > maxLoc };
}

// "Someone still intends to do this". Drafts count: a draft story is exactly
// the triage record `touching` exists to surface.
export const OPEN_STORY_STATUSES: readonly string[] = [
  "draft",
  "ready",
  "claimed",
  "in-progress",
  "blocked",
];

export function listFilteredIn(
  index: RankingIndex,
  opts: { rfc?: string; status?: string; cluster?: string } = {},
): Story[] {
  return index.stories.filter((s) => {
    if (opts.rfc && s.rfc_id !== opts.rfc) return false;
    // EFFECTIVE status, not the authored one: the CLI filters the published
    // index, where a `ready` story under a non-active RFC is already a `draft`.
    // Filtering the raw column instead put 267 such stories under
    // `--status ready` that the CLI reports as `draft` — a caller trusting
    // `list --status ready` would be reading a queue nobody can claim.
    if (opts.status && effectiveStoryStatus(index.rfcStatus.get(s.rfc_id), s.status) !== opts.status)
      return false;
    if (opts.cluster && s.cluster !== opts.cluster) return false;
    return true;
  });
}

// Matched in tiers — exact, then directory-prefix, then substring. Only the
// first tier that matches is returned, so a precise query is never diluted by
// the loose fallbacks.
export function storiesTouchingIn(
  index: RankingIndex,
  query: string,
  opts: { all?: boolean } = {},
): Story[] {
  const q = query.replace(/^\.\//, "");
  const dir = q.endsWith("/") ? q : `${q}/`;
  const scoped = index.stories.filter((s) => {
    const status = effectiveStoryStatus(index.rfcStatus.get(s.rfc_id), s.status);
    return opts.all || (status != null && OPEN_STORY_STATUSES.includes(status));
  });
  const tier = (match: (p: string) => boolean): Story[] =>
    scoped.filter((s) => (index.paths.get(s.id) ?? []).some(match));
  const exact = tier((p) => p === q);
  if (exact.length) return exact;
  const prefixed = tier((p) => p.startsWith(dir));
  if (prefixed.length) return prefixed;
  return tier((p) => p.includes(q));
}
