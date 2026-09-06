/**
 * The story object every read verb returns.
 *
 * This shape is NOT a design exercise. It reproduces `readmodel.ts`'s
 * `buildIndex()` story mapping field for field, because two consumers already
 * parse it today: btwhooks' Go side unmarshals `index.json` directly
 * (spawnloop.go `loadIndex`, rfccharts.go), and the CLI's `--json` output IS
 * these objects. Adding, renaming or reordering a field here is a cross-repo
 * break, so the serializer is deliberately dull — the interesting decisions
 * were all made in readmodel.ts and are only restated in comments.
 *
 * `test/serializers/story-json.test.ts` diffs the output against the published
 * `index.json` for the full RFC set, which is the real guard.
 */
import { effectiveStoryStatus } from "../models/concerns/effective-status.js";
import type { Story } from "../models/index.js";
import type { RankingIndex } from "../models/concerns/ranking.js";

export interface StoryJson {
  id: string;
  rfc: string;
  title: string | null;
  status: string;
  raw_status: string | null;
  cluster: string | null;
  packages: string[];
  priority: number | null;
  updated: string | null;
  deps: string[];
  deps_rfc: string[];
  est_loc: number | null;
  pr: number | null;
  claim: string | null;
  assignee: string | null;
  blocked_by: string | null;
  closed_reason: string | null;
  story_paths: string[];
  file_path: string | null;
}

/**
 * Frontmatter dates were parsed by js-yaml into Dates, so `index.json` carries
 * ISO midnight. Reproduce that from the stored date-only string, taking the
 * date part defensively: a value that carried a time component used to build
 * an Invalid Date and take every verb down for everyone, so an unparseable
 * value drops the field rather than the response.
 */
export function isoMidnight(value: unknown): string | null {
  if (value == null || value === "") return null;
  const day = String(value).slice(0, 10);
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function asString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

/**
 * The snapshot a serialization reads: `Story.rankingIndex()`, which every read
 * verb already loads. Taking it rather than querying for itself is what keeps a
 * request at one pass per table — the queue and the serializer read the SAME
 * six tables, and scanning them twice over a 7k-story backlog in the request
 * path is exactly what `rankingIndex` and `buildIndex` both went out of their
 * way to avoid.
 */
export type StoryJsonContext = RankingIndex;

export function serializeStory(story: Story, context: StoryJsonContext): StoryJson {
  const raw = asString(story.status);
  return {
    id: story.id,
    rfc: story.rfc_id,
    title: story.title ?? null,
    status: effectiveStoryStatus(context.rfcStatus.get(story.rfc_id) ?? null, raw) as string,
    raw_status: raw,
    cluster: story.cluster ?? null,
    packages: context.packages.get(story.id) ?? [],
    priority: integerOrNull(story.priority),
    updated: isoMidnight(story.updated_on),
    deps: context.deps.get(story.id) ?? [],
    deps_rfc: context.rfcDeps.get(story.id) ?? [],
    est_loc: story.est_loc ?? null,
    pr: story.pr ?? null,
    claim: asString(story.claim_at),
    assignee: story.assignee ?? null,
    blocked_by: story.blocked_by ?? null,
    closed_reason: story.closed_reason ?? null,
    story_paths: context.paths.get(story.id) ?? [],
    file_path: story.file_path ?? null,
  };
}

export function serializeStories(stories: Story[], context: StoryJsonContext): StoryJson[] {
  return stories.map((story) => serializeStory(story, context));
}
