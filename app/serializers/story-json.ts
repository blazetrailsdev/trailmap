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
import { Rfc, Story, StoryDep, StoryPackage, StoryPath, StoryRfcDep } from "../models/index.js";

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
 * A non-active parent RFC overrides its stories' queue status: a `ready` story
 * under a draft/closed/unknown RFC must never surface as claimable to ANY
 * consumer. Only `ready` downgrades — in-flight and terminal statuses record
 * facts, not claimability. Ported from `scripts/validate-lib.mjs`'s
 * `effectiveStoryStatus`, which is what `index.json` emits today; the authored
 * value is preserved as `raw_status`.
 */
export function effectiveStoryStatus(
  rfcStatus: string | null,
  storyStatus: string | null,
): string | null {
  if (storyStatus === "ready" && rfcStatus !== "active") return "draft";
  return storyStatus;
}

/**
 * Frontmatter dates were parsed by js-yaml into Dates, so `index.json` carries
 * ISO midnight. Reproduce that from the stored date-only string, taking the
 * date part defensively: a value that carried a time component used to build
 * an Invalid Date and take every verb down for everyone, so an unparseable
 * value drops the field rather than the response.
 */
function isoMidnight(value: unknown): string | null {
  if (value == null || value === "") return null;
  const day = String(value).slice(0, 10);
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function asString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function groupBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => string) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(value(row));
    else grouped.set(key(row), [value(row)]);
  }
  return grouped;
}

/** Everything the join columns and the parent RFC contribute, loaded once. */
export interface StoryJsonContext {
  rfcStatus: ReadonlyMap<string, string>;
  deps: ReadonlyMap<string, string[]>;
  rfcDeps: ReadonlyMap<string, string[]>;
  paths: ReadonlyMap<string, string[]>;
  packages: ReadonlyMap<string, string[]>;
}

/**
 * One query per join table rather than per-row association loads: a `list`
 * over 7k stories would otherwise be an N+1 in the request path.
 */
export async function storyJsonContext(): Promise<StoryJsonContext> {
  const [rfcs, deps, rfcDeps, paths, packages] = await Promise.all([
    Rfc.all().toArray(),
    StoryDep.all().toArray(),
    StoryRfcDep.all().toArray(),
    StoryPath.all().toArray(),
    StoryPackage.all().toArray(),
  ]);
  return {
    rfcStatus: new Map(rfcs.map((r) => [r.id, r.status as string])),
    deps: groupBy(deps, (d) => d.story_id, (d) => d.depends_on_id),
    rfcDeps: groupBy(rfcDeps, (d) => d.story_id, (d) => d.rfc_id),
    paths: groupBy(paths, (p) => p.story_id, (p) => p.path),
    packages: groupBy(packages, (p) => p.story_id, (p) => p.package),
  };
}

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

export async function serializeStories(stories: Story[]): Promise<StoryJson[]> {
  const context = await storyJsonContext();
  return stories.map((story) => serializeStory(story, context));
}
