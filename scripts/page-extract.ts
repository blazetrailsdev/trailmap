/**
 * What the show pages SAY, pulled out of the two implementations' HTML.
 *
 * The gate this backs (`scripts/page-equivalence.ts`) compares ringo's
 * `/rfc/<id>` and `/story/<id>` against trailmap's over the whole database.
 * The two render entirely different markup — #7's status vocabulary, the
 * GitHub restyle, a sidebar of ringo's own actions that trailmap deliberately
 * does not port — so a raw-HTML diff would be red on every page and would say
 * nothing about whether the pages agree.
 *
 * What is compared instead is the VALUES: the title, the status, the ordered
 * story list and the done count. Everything in this module is the extraction
 * of those from one side's HTML, kept apart from the runner so it can be
 * tested against fixed markup without a server on either end.
 *
 * The extractors are regexes over known class names rather than a parse. That
 * is a deliberate limit: they are pinned to markup both repositories own, and
 * a class rename on either side must fail the gate loudly (an extractor that
 * finds nothing reports "", which differs from the other side) rather than
 * quietly degrade into a comparison of two empty strings — which is why
 * `scripts/page-equivalence.ts` refuses a page whose title comes back empty.
 */

/** The facts an RFC show page states about its RFC. */
export interface RfcPageFacts {
  title: string;
  /** ringo's state LABEL, which is the vocabulary the two are compared in. */
  status: string;
  /** Story ids, in the order the page lists them. Order is part of the port. */
  stories: string[];
  done: number;
  total: number;
}

/** The facts a story show page states about its story. */
export interface StoryPageFacts {
  title: string;
  status: string;
  /** The parent RFC's id. */
  rfc: string;
  /** Dependency story ids, in page order. */
  deps: string[];
  /** Dependency RFC ids, in page order. */
  rfcDeps: string[];
}

/**
 * An RFC status as ringo's state pill spells it (`rfcState`,
 * webhook/rfcs.go:56).
 *
 * trailmap prints the status column itself — #7's rule is one vocabulary in
 * one place, and that place is the database — so the two pills never read the
 * same. Mapping trailmap's raw status THROUGH ringo's table is what makes the
 * comparison about the status rather than about the wording: an RFC that is
 * `closed` on one page and `active` on the other still fails, while `Closed`
 * against `closed` does not.
 */
export function rfcStateLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "draft":
      return "Draft";
    case "postponed":
      return "Postponed";
    case "closed":
      return "Closed";
    case "superseded":
      return "Superseded";
    default:
      return status === "" ? "—" : status;
  }
}

/**
 * A story status as ringo's state pill spells it (`storyState`,
 * webhook/story.go:330).
 *
 * This one LOSES information: ringo folds ready, draft, claimed and
 * in-progress all onto "Open". Comparing in ringo's vocabulary therefore
 * cannot catch a ready/in-progress mix-up — but comparing in trailmap's
 * cannot be done at all, because ringo's page never printed the raw status to
 * extract. The story list on the RFC page is where the fine-grained status is
 * checked: ringo prints the bare status there (`<span class="badge s-...">`),
 * so nothing is left unproven by this coarser pill.
 */
export function storyStateLabel(status: string): string {
  switch (status) {
    case "done":
      return "Merged";
    case "closed":
      return "Closed";
    case "blocked":
      return "Blocked";
    default:
      return "Open";
  }
}

/** ringo's `/rfc/<id>/stories`. The stories TAB, which is where the list is. */
export function extractRingoRfc(html: string): RfcPageFacts {
  const counts = /Stories \((\d+)\/(\d+) done\)/.exec(html);
  return {
    title: text(section(html, "pr-title")),
    status: text(section(html, "state state-[a-z]+")),
    stories: hrefIds(html, "story"),
    done: counts === null ? -1 : Number(counts[1]),
    total: counts === null ? -1 : Number(counts[2]),
  };
}

/** trailmap's `/rfc/<id>`. */
export function extractTrailmapRfc(html: string): RfcPageFacts {
  const open = /<span class="count">(\d+) <span class="n">open/.exec(html);
  const done = /<span class="count">(\d+) <span class="n">done/.exec(html);
  return {
    title: text(section(html, "page-title")),
    // The pill prints the raw column; ringo's table is applied here so both
    // sides arrive in one vocabulary.
    status: rfcStateLabel(text(section(html, "state s-[a-z-]+"))),
    // Scoped to the story box. trailmap renders the RFC's markdown on this
    // same page — ringo puts it on another tab — and a document that links to
    // a story would otherwise arrive as an extra row in the list.
    stories: hrefIds(between(html, '<div class="box-header">', '<h2 class="section-title">'), "story"),
    // Total is derived from open+done rather than read off the progress line,
    // which an RFC with no stories does not render at all.
    done: done === null ? -1 : Number(done[1]),
    total: open === null || done === null ? -1 : Number(open[1]) + Number(done[1]),
  };
}

/** ringo's `/story/<id>`. */
export function extractRingoStory(html: string): StoryPageFacts {
  return {
    // ringo hangs the PR number off the title as `<span class="num">#123</span>`,
    // the way GitHub does. It is the PR, not the title, and trailmap puts it in
    // the subhead instead — so it comes out before the text does.
    title: text(section(html, "pr-title").replace(/<span class="num">[\s\S]*?<\/span>/, "")),
    status: text(section(html, "state state-[a-z]+")),
    rfc: hrefIds(html, "rfc")[0] ?? "",
    // The sidebar's "Depends on" sections. ringo links dep RFCs from the
    // blocked banner as well, so the sections are sliced out by their heading
    // rather than scanned for over the whole page.
    deps: hrefIds(sidebarSection(html, "Depends on"), "story"),
    rfcDeps: hrefIds(sidebarSection(html, "Depends on RFCs"), "rfc"),
  };
}

/** trailmap's `/story/<id>`. */
export function extractTrailmapStory(html: string): StoryPageFacts {
  // The dep box, sliced out by its own header and the Document heading that
  // always follows it — the page renders no dep box at all when there are none.
  const rows = between(html, '<span class="count">Depends on</span>', '<h2 class="section-title">');
  return {
    title: text(section(html, "page-title")),
    status: storyStateLabel(text(section(html, "state s-[a-z-]+"))),
    rfc: hrefIds(html, "rfc")[0] ?? "",
    deps: hrefIds(rows, "story"),
    // The dep box lists story deps and then RFC deps; an RFC dep is the row
    // whose link is to /rfc/<id>, which is exactly what this picks out.
    rfcDeps: hrefIds(rows, "rfc"),
  };
}

/**
 * Whether ringo rendered its "no such record" page rather than a record.
 *
 * ringo answers 200 for an unknown id — its page IS the message — so the
 * status code cannot say. The runner needs this to tell "both sides agree the
 * id is gone" from "one side has lost a record".
 */
export function ringoNotFound(html: string): boolean {
  return /No (rfc|story) found with id/.test(html);
}

/**
 * The first element whose class attribute matches `cls`, inner HTML only.
 *
 * `cls` is a regex source, so a caller can ask for `state state-[a-z]+`
 * without knowing which arm of the state table this page took.
 */
export function section(html: string, cls: string): string {
  const open = new RegExp(`<(div|span|h1|h2)\\s+class="${cls}"\\s*>`).exec(html);
  if (open === null) return "";
  const from = open.index + open[0].length;
  const close = html.indexOf(`</${open[1]}>`, from);
  return close === -1 ? html.slice(from) : html.slice(from, close);
}

/** ringo's sidebar block under the `<div class="s-title">` heading `title`. */
export function sidebarSection(html: string, title: string): string {
  const head = `<div class="s-title">${title}</div>`;
  const at = html.indexOf(head);
  if (at === -1) return "";
  const from = at + head.length;
  const next = html.indexOf('<div class="s-title">', from);
  return next === -1 ? html.slice(from) : html.slice(from, next);
}

/** `html` between the first `from` and the `to` that follows it. */
export function between(html: string, from: string, to: string): string {
  const at = html.indexOf(from);
  if (at === -1) return "";
  const start = at + from.length;
  const end = html.indexOf(to, start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

/** Every `/<kind>/<id>` link target in `html`, in order, with repeats kept. */
export function hrefIds(html: string, kind: "rfc" | "story"): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`href="/${kind}/([^"#?]+)"`, "g");
  for (const match of html.matchAll(pattern)) {
    // ringo links its own tabs as `/rfc/<id>/stories`; the id is the head.
    found.push(match[1].split("/")[0]);
  }
  return found;
}

/**
 * `html` as the text a reader sees: tags dropped, entities decoded, runs of
 * whitespace collapsed. Both sides escape their values, and they do not always
 * escape them the same way (`&#39;` against `&#x27;`), so decoding is what
 * keeps an apostrophe in a title from reading as a difference.
 */
export function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

/** The entity forms these two templates actually emit, decoded. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/**
 * The fields of `a` and `b` that differ, named — the report a mismatch turns
 * into. Ordered lists report their first differing position, in the voice of
 * `scripts/equivalence.ts`'s `describe`.
 */
export function diffFacts(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(a)) {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.join("\n") === right.join("\n")) continue;
      const at = left.findIndex((value, i) => value !== right[i]);
      const first = at === -1 ? Math.min(left.length, right.length) : at;
      problems.push(
        `${key}: ${left.length} ringo vs ${right.length} trailmap; first difference at ` +
          `${first} (ringo=${left[first] ?? "(end)"} trailmap=${right[first] ?? "(end)"})`,
      );
      continue;
    }
    if (left !== right) problems.push(`${key}: ringo=${show(left)} trailmap=${show(right)}`);
  }
  return problems;
}

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
