import { describe, expect, it } from "vitest";
import {
  decodeRows,
  decodeSnapshot,
  encodeRows,
  encodeSnapshot,
  factsOf,
  isExempt,
  type PageRecord,
  type RowRecord,
} from "../../scripts/page-snapshot.js";

/**
 * The fixture format, over fixed records rather than over the 8,953-page
 * recording it holds.
 *
 * Two properties are load-bearing and neither is obvious from reading the
 * encoder. A re-record must produce a diff that reads page by page, which
 * needs a stable sort and a fixed key order — otherwise a recording that says
 * exactly what the last one said still arrives as a rewritten file, and the
 * review the story asks for is not possible. And an exempt story must survive
 * the round trip as exempt: it is the record of a divergence trailmap chose
 * (ringo hides 4,747 stories under a closed RFC and trailmap serves them),
 * and a decode that lost the flag would turn it into a page the replay
 * expects ringo's facts for.
 */
const RFC: PageRecord = {
  kind: "rfc",
  id: "0136-trailmap",
  title: "trailmap",
  status: "Active",
  stories: ["b", "a"],
  storyStatuses: ["ready", "done"],
  done: 1,
  total: 2,
};

const STORY: PageRecord = {
  kind: "story",
  id: "render-the-show-pages",
  title: "Render the show pages",
  status: "Merged",
  rfc: "0136-trailmap",
  deps: ["port-the-models"],
  rfcDeps: [],
};

const EXEMPT: PageRecord = { kind: "story", id: "under-a-closed-rfc", exempt: true };

describe("the show-page snapshot format", () => {
  it("round-trips every record", () => {
    const records = [STORY, RFC, EXEMPT];
    expect(decodeSnapshot(encodeSnapshot(records))).toEqual([RFC, STORY, EXEMPT]);
  });

  it("sorts by kind and then by id, so a re-record diffs page by page", () => {
    const ids = decodeSnapshot(encodeSnapshot([STORY, EXEMPT, RFC])).map((r) => `${r.kind}/${r.id}`);
    expect(ids).toEqual([
      "rfc/0136-trailmap",
      "story/render-the-show-pages",
      "story/under-a-closed-rfc",
    ]);
  });

  it("writes a record's keys in one order however the extractor built it", () => {
    const shuffled = { total: 2, id: "0136-trailmap", kind: "rfc", stories: ["b", "a"] };
    const reordered = { kind: "rfc", stories: ["b", "a"], id: "0136-trailmap", total: 2 };
    expect(encodeSnapshot([shuffled as unknown as PageRecord])).toEqual(
      encodeSnapshot([reordered as unknown as PageRecord]),
    );
  });

  it("keeps an exempt story exempt", () => {
    const [decoded] = decodeSnapshot(encodeSnapshot([EXEMPT]));
    expect(isExempt(decoded as { kind: "story"; id: string; exempt: true })).toBe(true);
  });

  it("strips the record's own keys off the facts the replay diffs", () => {
    expect(factsOf(RFC as never)).toEqual({
      title: "trailmap",
      status: "Active",
      stories: ["b", "a"],
      storyStatuses: ["ready", "done"],
      done: 1,
      total: 2,
    });
  });

  it("round-trips rows in the order they were read", () => {
    const rows: RowRecord[] = [
      { table: "story_deps", row: { story_id: "a", depends_on_id: "z" } },
      { table: "story_deps", row: { story_id: "a", depends_on_id: "b" } },
    ];
    expect(decodeRows(encodeRows(rows))).toEqual(rows);
  });
});
