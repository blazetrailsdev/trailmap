/**
 * The five rows of trails' `attribute-reads-allocate-a-block-on-every-cache-hit`
 * table, measured on trailmap's `Story` over the live tasks database:
 *
 *   TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db pnpm tsx scripts/bench-story-reads.ts
 *
 * Each row is run five times and printed as its fastest-slowest range, the
 * shape that table records.
 */
import { exit } from "@blazetrails/ruby-compat";
import "../config.ts";
import { Story } from "../app/models/index.ts";
import { serializeStories } from "../app/serializers/story-json.ts";

const RUNS = 5;

async function time(label: string, run: () => unknown): Promise<void> {
  const ms: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    ms.push(performance.now() - start);
  }
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`);
  console.log(`| ${label.padEnd(39)} | ${fmt(Math.min(...ms))}-${fmt(Math.max(...ms))} |`);
}

let stories: Story[] = [];
await time("`Story.all().toArray()`", async () => {
  stories = await Story.all().toArray();
});
const reads = stories.length * 10;
let sink: unknown;
await time(`${reads.toLocaleString("en-US")} reads of \`story.id\``, () => {
  for (let r = 0; r < 10; r++) for (const s of stories) sink = s.id;
});
await time(`${reads.toLocaleString("en-US")} reads of \`story.priority\``, () => {
  for (let r = 0; r < 10; r++) for (const s of stories) sink = s.priority;
});
await time(`sort ${stories.length.toLocaleString("en-US")} records by \`(priority, id)\``, () =>
  [...stories].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id)),
);
const index = await Story.rankingIndex();
await time("serialize all (about 20 reads a record)", () => serializeStories(stories, index));
void sink;
exit(0);
