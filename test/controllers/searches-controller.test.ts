import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { setX } from "../support/config-x.ts";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Meta, Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import {
  SEARCH_PAGE_SIZE,
  SearchesController,
} from "../../app/controllers/searches-controller.ts";
import {
  bodyIndex,
  compareHits,
  resetBodyIndex,
  search,
  searchPhrase,
  withSnippets,
  type SearchHit,
} from "../../app/models/concerns/search.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/** `/search`, over a scratch database and a scratch tasks checkout. */
let dir: string;

async function show(params: Record<string, string>) {
  const tc = await controllerTestCase(SearchesController);
  await tc.get("show", { params });
  return tc.response;
}

async function write(path: string, body: string): Promise<void> {
  const fs = getFs();
  await fs.mkdir!(`${dir}/${path.replace(/\/[^/]+$/, "")}`, {
    recursive: true,
  });
  await fs.writeFile!(`${dir}/${path}`, body);
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  dir = await getFs().mkdtemp!("/tmp/trailmap-search-");
  setX("tasks", "dir", dir);

  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({
    id: "0042-serialize",
    status: "active",
    title: "Serialize everything",
    file_path: "rfcs/0042/README.md",
  });
  await write("rfcs/0042/README.md", "---\nid: 0042\n---\nThe RFC body.");

  await Story.create({
    id: "serialize",
    rfc_id: "0042-serialize",
    status: "ready",
    title: "An exact id",
  });
  await Story.create({
    id: "port-it",
    rfc_id: "0042-serialize",
    status: "draft",
    title: "Serialize the coder",
  });
  await Story.create({
    id: "middle",
    rfc_id: "0042-serialize",
    status: "done",
    title: "Teach has_many to serialize",
  });
  await Story.create({
    id: "once",
    rfc_id: "0042-serialize",
    status: "ready",
    title: "Unrelated",
    file_path: "s/once.md",
  });
  await Story.create({
    id: "thrice",
    rfc_id: "0042-serialize",
    status: "ready",
    title: "Also unrelated",
    file_path: "s/thrice.md",
  });
  await Story.create({
    id: "pct",
    rfc_id: "0042-serialize",
    status: "ready",
    title: "est_loc is 100%",
  });
  await Story.create({
    id: "pcx",
    rfc_id: "0042-serialize",
    status: "ready",
    title: "estxloc is 100",
  });
  await write("s/once.md", "---\nid: once\n---\nCalls Serialize once.");
  await write(
    "s/thrice.md",
    "---\nid: thrice\nnote: serialize\n---\nserialize, serialize and SERIALIZE.",
  );
});

beforeEach(() => resetBodyIndex());

afterAll(async () => {
  await getFs().rm!(dir, { recursive: true, force: true });
});

describe("search", () => {
  it("ranks an exact id, then a title prefix, then a title match, then bodies by mentions", async () => {
    const hits = await search("serialize");
    expect(hits.map((hit) => `${hit.kind}:${hit.id}`)).toEqual([
      "story:serialize",
      "rfc:0042-serialize",
      "story:port-it",
      "story:middle",
      "story:thrice",
      "story:once",
    ]);
  });

  it("counts body mentions without the frontmatter, and shows the body as written", async () => {
    const [thrice] = await withSnippets(
      (await search("serialize")).filter((hit) => hit.id === "thrice"),
      "serialize",
    );
    expect(thrice!.mentions).toBe(3);
    expect(thrice!.snippet).toContain("SERIALIZE");
  });

  it("matches a LIKE wildcard in the phrase literally", async () => {
    expect((await search("est_loc")).map((hit) => hit.id)).toEqual(["pct"]);
    expect((await search("100%")).map((hit) => hit.id)).toEqual(["pct"]);
  });

  it("rereads the bodies when an ingest moves the sha", async () => {
    expect(await search("freshly written")).toEqual([]);
    await write("s/once.md", "freshly written");
    expect(await search("freshly written")).toEqual([]);
    await Meta.set("last_ingested_sha", "a-new-ingest");
    expect((await search("freshly written")).map((hit) => hit.id)).toEqual([
      "once",
    ]);
    await write("s/once.md", "---\nid: once\n---\nCalls Serialize once.");
  });

  it("orders by tier, then mentions, then RFC before story, then id", () => {
    const hit = (over: Partial<SearchHit>): SearchHit => ({
      kind: "story",
      id: "b",
      title: "",
      filePath: null,
      status: "ready",
      rfcId: null,
      tier: 2,
      mentions: 0,
      snippet: "",
      ...over,
    });
    expect(
      compareHits(hit({ tier: 1 }), hit({ tier: 2, mentions: 9 })),
    ).toBeLessThan(0);
    expect(
      compareHits(hit({ mentions: 3 }), hit({ mentions: 1 })),
    ).toBeLessThan(0);
    expect(
      compareHits(hit({ kind: "rfc", id: "z" }), hit({ id: "a" })),
    ).toBeLessThan(0);
    expect(compareHits(hit({ id: "a" }), hit({ id: "b" }))).toBeLessThan(0);
    expect(compareHits(hit({}), hit({}))).toBe(0);
  });

  it("indexes each body once per ingest, keyed kind:id, frontmatter stripped", async () => {
    const first = await bodyIndex();
    expect(first.get("story:thrice")).toBe(
      "serialize, serialize and serialize.",
    );
    expect(first.get("rfc:0042-serialize")).toBe("the rfc body.");
    expect(first.has("story:serialize")).toBe(false);
    expect(await bodyIndex()).toBe(first);
    resetBodyIndex();
    expect(await bodyIndex()).not.toBe(first);
  });

  it("bounds the phrase", () => {
    expect(searchPhrase(undefined)).toBeNull();
    expect(searchPhrase(" a ")).toBeNull();
    expect(searchPhrase("  two   words ")).toBe("two words");
    expect(searchPhrase("x".repeat(500))).toHaveLength(100);
    expect(searchPhrase(`${"x".repeat(99)}   y`)).toBe("x".repeat(99));
  });
});

describe("SearchesController", () => {
  it("renders the form and no results without a phrase", async () => {
    const response = await show({});
    expect(response.status).toBe(200);
    expect(response.body).toContain('name="q"');
    expect(response.body).not.toContain("results for");
  });

  it("says a one-character phrase is too short", async () => {
    expect((await show({ q: "s" })).body).toContain("at least 2 characters");
  });

  it("lists the hits with links to their pages", async () => {
    const body = (await show({ q: "serialize" })).body;
    expect(body).toContain("6 results for <strong>serialize</strong>");
    expect(body).toContain('href="/story/serialize"');
    expect(body).toContain('href="/rfc/0042-serialize"');
  });

  it("escapes the phrase it echoes", async () => {
    const body = (await show({ q: "<script>x" })).body;
    expect(body).not.toContain("<script>x");
    expect(body).toContain("&lt;script&gt;x");
  });

  it("pages with the shared pager, keeping the phrase in its links", async () => {
    for (let i = 0; i <= SEARCH_PAGE_SIZE; i++) {
      await Story.create({
        id: `paged-${String(i).padStart(2, "0")}`,
        rfc_id: "0042-serialize",
        status: "ready",
        title: "Paged hit",
      });
    }
    const first = (await show({ q: "paged hit" })).body;
    expect(first).toContain('data-pages="2"');
    expect(first).toContain('href="/search?q=paged%20hit&amp;page=2"');
    const second = (await show({ q: "paged hit", page: "2" })).body;
    expect(second).toContain("51&ndash;51 of 51");
    expect(second.match(/class="item-row"/g)).toHaveLength(1);
  });
});
