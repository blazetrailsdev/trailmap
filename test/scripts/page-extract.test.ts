import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  diffFacts,
  extractRingoRfc,
  extractRingoStory,
  extractTrailmapRfc,
  extractTrailmapStory,
  ringoRfcRows,
  ringoStoryRows,
  barKey,
  trailmapRfcBars,
  trailmapRfcRows,
  trailmapStoryRows,
  badgeStatuses,
  between,
  hrefIds,
  rfcStateLabel,
  ringoNotFound,
  section,
  sidebarSection,
  storyStateLabel,
  text,
  trailmapStoryPill,
} from "../../scripts/page-extract.ts";

/**
 * The markup here is COPIED from the two implementations, not invented:
 * ringo's from `webhook/rfcs.go`'s `rfcShowHTML` and `webhook/story.go`'s
 * `storyHTML`, trailmap's from `app/views/rfc-pages/show.html.tse` and
 * `app/views/story-pages/show.html.tse`. That is what makes the test worth
 * anything — an extractor is only ever right about the markup it is pointed
 * at, and a fixture written to suit the regex proves nothing.
 */
const ringoRfc = `<div class="pr-title">A title &amp; a half</div>
  <div class="pr-sub">
    <span class="state state-open">Active</span>
    <span><strong>dean</strong> · <code>0001-x</code></span>
  </div>
  <div class="layout">
    <div class="main">
      <div class="card">
        <div class="card-head"><span>Stories (2/3 done)</span></div>
        <div class="srow"><span class="badge s-ready">ready</span>
          <span class="stitle"><a href="/story/beta">Beta</a></span></div>
        <div class="srow"><span class="badge s-done">done</span>
          <span class="stitle"><a href="/story/alpha">Alpha</a></span></div>
      </div>
    </div>
    <div class="sidebar"><div class="s-row"><span class="k">Stories</span><span>2/3 done</span></div>
      <div class="s-sec"><div class="s-title">Related RFCs</div>
        <div class="labels"><a href="/story/mentioned-in-the-sidebar">nope</a></div></div>
    </div>
  </div>`;

const trailmapRfc = `<div class="page-header">
    <h1 class="page-title">A title &amp; a half</h1>
    <div class="page-subhead">
      <span class="id">0001-x</span>
      <span class="state s-active">active</span>
    </div>
  </div>
  <div class="box">
    <div class="box-header">
      <span class="count">1 <span class="n">open</span></span>
      <span class="count">2 <span class="n">done</span></span>
    </div>
    <div class="item-row"><span class="badge s-ready">ready</span>
      <span class="row-main"><a class="row-title" href="/story/beta">Beta</a></span></div>
    <div class="item-row"><span class="badge s-done">done</span>
      <span class="row-main"><a class="row-title" href="/story/alpha">Alpha</a></span></div>
  </div>
  <h2 class="section-title">Document</h2>
  <article class="markdown"><a href="/story/mentioned-in-prose">see this</a></article>`;

const ringoStory = `<div class="pr-title">Do the thing <span class="num">#42</span></div>
  <div class="pr-sub">
    <span class="state state-open">
      <svg width="15"><path d="M1.5"/></svg>
      Open
    </span>
    <span><strong>ringo</strong> opened this story for <a href="/rfc/0001-x"><code>0001-x</code></a></span>
  </div>
  <div class="sidebar">
    <div class="s-sec"><div class="s-title">Depends on</div>
      <div class="labels"><a href="/story/first"><code>first</code></a> <a href="/story/second"><code>second</code></a> </div></div>
    <div class="s-sec"><div class="s-title">Depends on RFCs</div>
      <div class="labels"><a href="/rfc/0002-y"><code>0002-y</code></a> <span class="badge s-closed">closed</span> </div></div>
  </div>`;

const trailmapStory = `<div class="page-header">
    <h1 class="page-title">Do the thing</h1>
    <div class="page-subhead">
      <span class="id">do-the-thing</span>
      <span class="state s-in-progress">in-progress</span>
      <span class="muted">in <a href="/rfc/0001-x">A title</a>, PR #42</span>
    </div>
  </div>
  <div class="box">
    <div class="box-header"><span class="count">Depends on</span></div>
    <div class="item-row"><span class="badge s-done">done</span>
      <span class="row-main"><a class="row-title" href="/story/first">first</a></span></div>
    <div class="item-row"><span class="badge s-done">done</span>
      <span class="row-main"><a class="row-title" href="/story/second">second</a></span></div>
    <div class="item-row"><span class="badge s-closed">closed</span>
      <span class="row-main"><a class="row-title" href="/rfc/0002-y">0002-y</a>
        <div class="row-meta">RFC</div></span></div>
  </div>
  <h2 class="section-title">Document</h2>
  <article class="markdown"><a href="/rfc/0009-z">a link in the prose</a></article>`;

describe("rfcStateLabel", () => {
  it("is ringo's vocabulary, including the em dash for an unset status", () => {
    expect(["active", "draft", "postponed", "closed", "superseded", ""].map(rfcStateLabel)).toEqual([
      "Active",
      "Draft",
      "Postponed",
      "Closed",
      "Superseded",
      "—",
    ]);
  });

  it("passes an unrecognised status through, as ringo's default arm does", () => {
    expect(rfcStateLabel("retired")).toBe("retired");
  });
});

describe("storyStateLabel", () => {
  it("folds every in-flight status onto Open, as ringo does", () => {
    expect(["ready", "draft", "claimed", "in-progress"].map(storyStateLabel)).toEqual([
      "Open",
      "Open",
      "Open",
      "Open",
    ]);
    expect(["done", "closed", "blocked"].map(storyStateLabel)).toEqual([
      "Merged",
      "Closed",
      "Blocked",
    ]);
  });
});

describe("extractRingoRfc / extractTrailmapRfc", () => {
  it("reads the same facts out of two different pages", () => {
    expect(extractRingoRfc(ringoRfc)).toEqual(extractTrailmapRfc(trailmapRfc));
  });

  it("reads them, rather than agreeing on nothing", () => {
    expect(extractRingoRfc(ringoRfc)).toEqual({
      title: "A title & a half",
      status: "Active",
      stories: ["beta", "alpha"],
      storyStatuses: ["ready", "done"],
      done: 2,
      total: 3,
    });
  });

  it("counts only the story box: not the document, and not the sidebar", () => {
    // trailmap renders the RFC's markdown on this same page and ringo does not;
    // ringo carries sidebar links trailmap has no equivalent for. Both are read
    // scoped, so neither leaks a row into the list.
    expect(extractTrailmapRfc(trailmapRfc).stories).toEqual(["beta", "alpha"]);
    expect(extractRingoRfc(ringoRfc).stories).toEqual(["beta", "alpha"]);
  });

  it("derives trailmap's total from open + done, which an empty RFC still renders", () => {
    const empty = trailmapRfc
      .replace('<span class="count">1 <span class="n">open</span></span>', '<span class="count">0 <span class="n">open</span></span>')
      .replace('<span class="count">2 <span class="n">done</span></span>', '<span class="count">0 <span class="n">done</span></span>');
    expect(extractTrailmapRfc(empty)).toMatchObject({ done: 0, total: 0 });
  });
});

describe("extractRingoStory / extractTrailmapStory", () => {
  it("reads the same facts out of two different pages", () => {
    expect(extractRingoStory(ringoStory)).toEqual(extractTrailmapStory(trailmapStory));
  });

  it("keeps ringo's PR number out of the title, where trailmap never put it", () => {
    expect(extractRingoStory(ringoStory)).toEqual({
      title: "Do the thing",
      status: "Open",
      rfc: "0001-x",
      deps: ["first", "second"],
      rfcDeps: ["0002-y"],
    });
  });

  it("does not read a dep out of the story's own document", () => {
    expect(extractTrailmapStory(trailmapStory).rfcDeps).toEqual(["0002-y"]);
  });
});

describe("trailmapStoryPill", () => {
  // The fold `extractTrailmapStory` applies is what the snapshot gate cannot
  // see through; this is the same pill before it.
  it("reads the status unfolded, where the folded fact says only Open", () => {
    const pill = trailmapStoryPill(trailmapStory);

    expect(pill).not.toBe("");
    expect(pill).not.toBe("Open");
    expect(storyStateLabel(pill)).toBe(extractTrailmapStory(trailmapStory).status);
  });

  it("tells apart two statuses the fold makes equal", () => {
    const page = (status: string) => `<span class="state s-${status}">${status}</span>`;

    expect(trailmapStoryPill(page("ready"))).toBe("ready");
    expect(trailmapStoryPill(page("in-progress"))).toBe("in-progress");
    expect(trailmapStoryPill("<p>no pill</p>")).toBe("");
  });
});

describe("ringoNotFound", () => {
  it("recognises the page ringo serves with a 200 for an id it does not have", () => {
    expect(ringoNotFound('<div class="tl-body err">No story found with id <code>x</code>')).toBe(true);
    expect(ringoNotFound('<div class="tl-body err">No rfc found with id <code>x</code>')).toBe(true);
    expect(ringoNotFound(ringoStory)).toBe(false);
  });
});

describe("section", () => {
  it("takes the inner HTML of the first element whose class matches", () => {
    expect(section(ringoRfc, "pr-title")).toBe("A title &amp; a half");
  });

  it("accepts a pattern, so a caller need not know which state arm was taken", () => {
    expect(section(trailmapRfc, "state s-[a-z-]+")).toBe("active");
  });

  it("reports nothing rather than guessing when the class is gone", () => {
    expect(section(ringoRfc, "renamed-away")).toBe("");
  });
});

describe("sidebarSection", () => {
  it("stops at the next heading, so one dep list does not swallow the other", () => {
    expect(hrefIds(sidebarSection(ringoStory, "Depends on"), "story")).toEqual([
      "first",
      "second",
    ]);
    expect(sidebarSection(ringoStory, "Depends on")).not.toContain("0002-y");
  });

  it("reports nothing for a heading the page does not carry", () => {
    expect(sidebarSection(ringoStory, "Clusters")).toBe("");
  });
});

describe("between", () => {
  it("takes what sits between the two markers", () => {
    expect(between("a<b>middle</b>c", "<b>", "</b>")).toBe("middle");
  });

  it("runs to the end when the closing marker never comes", () => {
    expect(between("a<b>middle", "<b>", "</b>")).toBe("middle");
  });

  it("reports nothing when the opening marker never comes", () => {
    expect(between("a<b>middle</b>c", "<i>", "</i>")).toBe("");
  });
});

describe("badgeStatuses", () => {
  it("reads the status out of the badge's class, which is where both sides put it", () => {
    expect(badgeStatuses(ringoRfc)).toEqual(["ready", "done"]);
    expect(badgeStatuses(trailmapRfc)).toEqual(["ready", "done"]);
  });

  it("keeps a hyphenated status whole", () => {
    expect(badgeStatuses('<span class="badge s-in-progress">in-progress</span>')).toEqual([
      "in-progress",
    ]);
  });
});

describe("hrefIds", () => {
  it("keeps page order and keeps repeats, both of which are compared", () => {
    expect(hrefIds('<a href="/story/b"></a><a href="/story/a"></a><a href="/story/b"></a>', "story"))
      .toEqual(["b", "a", "b"]);
  });

  it("takes the id off a tab link, which ringo writes as /rfc/<id>/stories", () => {
    expect(hrefIds('<a href="/rfc/0001-x/stories">', "rfc")).toEqual(["0001-x"]);
  });

  it("does not confuse the two kinds", () => {
    expect(hrefIds(trailmapStory, "rfc")).toContain("0001-x");
    expect(hrefIds(trailmapStory, "story")).toEqual(["first", "second"]);
  });
});

describe("text", () => {
  it("drops markup and collapses the whitespace an SVG leaves behind", () => {
    expect(text('<span>\n  <svg><path d="M1"/></svg>\n  Open\n</span>')).toBe("Open");
  });
});

describe("decodeEntities", () => {
  it("decodes the forms the two templates actually emit", () => {
    // Go escapes an apostrophe as &#39;, the .tse compiler as &#x27;. Both are
    // an apostrophe, and neither is a difference between the pages.
    expect(decodeEntities("ringo&#39;s")).toBe("ringo's");
    expect(decodeEntities("ringo&#x27;s")).toBe("ringo's");
    expect(decodeEntities("a &amp; b &middot; c")).toBe("a & b · c");
  });

  it("leaves something that is not an entity alone", () => {
    expect(decodeEntities("Q&A; 5 &notareal; thing")).toBe("Q&A; 5 &notareal; thing");
  });
});

describe("diffFacts", () => {
  it("says nothing when the two agree", () => {
    expect(diffFacts({ title: "a", ids: ["x"] }, { title: "a", ids: ["x"] })).toEqual([]);
  });

  it("names the field, and an ordered list's first differing position", () => {
    expect(diffFacts({ done: 1 }, { done: 2 })).toEqual(["done: ringo=1 trailmap=2"]);
    expect(diffFacts({ ids: ["a", "b"] }, { ids: ["a", "c"] })).toEqual([
      "ids: 2 ringo vs 2 trailmap; first difference at 1 (ringo=b trailmap=c)",
    ]);
  });

  it("reports the end of the shorter list rather than undefined", () => {
    expect(diffFacts({ ids: ["a"] }, { ids: ["a", "b"] })).toEqual([
      "ids: 1 ringo vs 2 trailmap; first difference at 1 (ringo=(end) trailmap=b)",
    ]);
  });
});


/**
 * LIST ROWS. Copied from the two implementations exactly as the show-page
 * fixtures above are: ringo's from `vendor/ringo/backlog-draw.js` and
 * `rfcs-draw.js` (the `labels` assembly and the row template), trailmap's from
 * `app/views/story-pages/index.html.tse` and `app/views/rfc-pages/index.html.tse`.
 */
const ringoStoryRow =
  `<div class="row"><span class="icon open"><svg/></span><div class="main">` +
  `<div class="titleline"><a class="title" href="/story/alpha">Alpha</a>` +
  `<span class="label next">next up</span>` +
  `<span class="label s-ready">ready</span>` +
  `<span class="label">rank</span>` +
  `<span class="label icebox" title="its RFC is a draft or postponed">icebox</span>` +
  `<span class="label pkg" title="package, inherited from RFC 0001-x">activerecord*</span>` +
  `<span class="label pkg" title="package, inherited from RFC 0001-x">arel*</span>` +
  `<span class="label" title="ready-queue priority (lower = sooner), inherited from RFC 0001-x">pri 3*</span>` +
  `</div><div class="meta"><code>alpha</code> · <a href="/rfc/0001-x">RFC 0001-x</a> · ~120 LOC · ` +
  `<span title="last edited 3 days ago">updated 3d ago</span> · by dean</div></div>` +
  `<div class="aside"><span class="pr"><a href="/story/alpha">#42</a></span></div></div>` +
  `<div class="row"><span class="icon done"><svg/></span><div class="main">` +
  `<div class="titleline"><a class="title" href="/story/beta">Beta &amp; co</a>` +
  `<span class="label queue">#3 in queue</span>` +
  `<span class="label pkg" title="package">actionpack</span>` +
  `<span class="label" title="ready-queue priority (lower = sooner)">pri 1</span>` +
  `</div><div class="meta"><code>beta</code> · <a href="/rfc/0001-x">RFC 0001-x</a></div></div>` +
  `<div class="aside"></div></div>`;

const trailmapStoryRow =
  `<div class="item-row"><span class="badge s-ready">ready</span><span class="row-main">` +
  `<span class="titleline"><a class="row-title" href="/story/alpha">Alpha</a>` +
  `<span class="tag next">next up</span>` +
  `<span class="tag">rank</span>` +
  `<span class="tag icebox" title="its RFC is a draft or postponed">icebox</span>` +
  `<span class="tag pkg" title="package, inherited from RFC 0001-x">activerecord*</span>` +
  `<span class="tag pkg" title="package, inherited from RFC 0001-x">arel*</span>` +
  `<span class="tag prio" title="ready-queue priority (lower = sooner), inherited from RFC 0001-x">pri 3*</span>` +
  `</span><div class="row-meta"><code>alpha</code> &middot; <a href="/rfc/0001-x">RFC 0001-x</a>` +
  ` &middot; ~120 LOC &middot; updated 3d ago &middot; by dean</div>` +
  `</span><span class="row-aside"><a href="/story/alpha">#42</a></span></div>` +
  `<div class="item-row"><span class="badge s-done">done</span><span class="row-main">` +
  `<span class="titleline"><a class="row-title" href="/story/beta">Beta &amp; co</a>` +
  `<span class="tag queue">#3 in queue</span>` +
  `<span class="tag pkg" title="package">actionpack</span>` +
  `<span class="tag prio" title="ready-queue priority (lower = sooner)">pri 1</span>` +
  `</span><div class="row-meta"><code>beta</code> &middot; <a href="/rfc/0001-x">RFC 0001-x</a></div>` +
  `</span></div>`;

const ringoRfcRow =
  `<div class="row"><span class="icon open"><svg/></span><div class="main">` +
  `<div class="titleline"><a class="title" href="/rfc/0001-x">An RFC</a>` +
  `<span class="label prio" title="RFC priority (lower = sooner)">P2</span>` +
  `<span class="label s-active">active</span>` +
  `<span class="label stalled" title="No ready stories left">needs refine</span>` +
  `<span class="label prog" title="stories done / total">3/7 done</span>` +
  `<span class="label">runtime</span>` +
  `<span class="label">→ 0002-y</span>` +
  `</div><div class="meta"><code>0001-x</code> · by dean · open 12d</div></div></div>`;

const trailmapRfcRow =
  `<div class="item-row"><span class="row-main">` +
  `<span class="titleline"><a class="row-title" href="/rfc/0001-x">An RFC</a>` +
  `<span class="tag prio" title="RFC priority (lower = sooner)">P2</span>` +
  `<span class="tag prog" title="stories done / total">3/7 done</span>` +
  `<span class="tag">runtime</span>` +
  `<span class="tag">&rarr; 0002-y</span>` +
  `</span><div class="row-meta"><code>0001-x</code> &middot; by dean &middot; open 12d</div>` +
  `</span></div>`;

describe("ringoStoryRows / trailmapStoryRows", () => {
  it("reads the same values off two differently-marked-up backlog rows", () => {
    expect(ringoStoryRows(ringoStoryRow)).toEqual(trailmapStoryRows(trailmapStoryRow));
  });

  it("reads the queue position, the inherited flags and the meta line", () => {
    expect(ringoStoryRows(ringoStoryRow)).toEqual([
      {
        id: "alpha",
        queue: "0",
        priority: "3",
        priorityInherited: true,
        packages: ["activerecord", "arel"],
        packagesInherited: true,
        estLoc: "120",
        icebox: true,
        cluster: "rank",
        pr: "42",
        assignee: "dean",
      },
      {
        id: "beta",
        queue: "2",
        priority: "1",
        priorityInherited: false,
        packages: ["actionpack"],
        packagesInherited: false,
        estLoc: "",
        icebox: false,
        cluster: "",
        pr: "",
        assignee: "",
      },
    ]);
  });

  it("differs when only the inherited mark differs, which is the rule #15 ported", () => {
    const ported = trailmapStoryRow.replace(">pri 3*<", ">pri 3<");
    expect(diffFacts(ringoStoryRows(ringoStoryRow)[0], trailmapStoryRows(ported)[0])).toEqual([
      "priorityInherited: ringo=true trailmap=false",
    ]);
  });
});

describe("trailmapRfcBars / barKey", () => {
  const seg = (status: string, count: number) =>
    `<span class="seg s-${status}" style="width:10%" title="${count} ${status}"></span>`;
  const cap = `<span class="sbarcap">4 stories</span>`;
  const withBar = trailmapRfcRow.replace("</span></div>", `${cap}${seg("done", 3)}${seg("in-progress", 1)}</span></div>`);

  it("says the markup changed when a row's segments do not add up to the total it states", () => {
    const renamed = withBar.replace(/class="seg s-done"/, 'class="segment done"');
    expect(() => trailmapRfcBars(renamed)).toThrow(/1 stories in segments, 4 stated/);
    expect(() => trailmapRfcBars("<html></html>")).toThrow(/no rows extracted/);
  });

  it("reads each row's segments by RFC id, and an RFC with no stories as an empty bar", () => {

    expect(trailmapRfcBars(withBar + trailmapRfcRow.replace("0001-x", "0002-y"))).toEqual(
      new Map([["0001-x", { done: 3, "in-progress": 1 }], ["0002-y", {}]]),
    );
  });

  it("folds ready and blocked into one count and compares every other status exactly", () => {
    expect(barKey({ ready: 2, blocked: 1, done: 4, draft: 0 })).toBe("4 done · 3 ready+blocked");
    expect(barKey({ ready: 1, blocked: 2, done: 4 })).toBe(barKey({ ready: 3, done: 4 }));
    expect(barKey({ draft: 3, done: 4 })).not.toBe(barKey({ ready: 3, done: 4 }));
  });
});

describe("ringoRfcRows / trailmapRfcRows", () => {
  it("reads the same values off two differently-marked-up RFC rows", () => {
    expect(ringoRfcRows(ringoRfcRow)).toEqual(trailmapRfcRows(trailmapRfcRow));
  });

  it("reads the priority, the tally, the clusters and the supersession", () => {
    expect(ringoRfcRows(ringoRfcRow)).toEqual([
      {
        id: "0001-x",
        priority: "2",
        progress: "3/7",
        clusters: ["runtime"],
        supersededBy: "0002-y",
        owner: "dean",
      },
    ]);
  });
});
