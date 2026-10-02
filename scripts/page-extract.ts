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
  /**
   * The status each of those rows wears, in the same order — the EFFECTIVE
   * status on both sides. Compared as well as the ids because a story list is
   * its rows: two pages that name the same stories in the same order and
   * disagree about which of them are claimable have not agreed.
   */
  storyStatuses: string[];
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
  // Scoped to the page's main column, as trailmap's is to its story box.
  // Nothing else on this tab links to a story today — but the two sides are
  // read the same way on purpose, so neither can start counting a link the
  // other never had.
  const main = between(html, '<div class="main">', '<div class="sidebar">');
  return {
    title: text(section(html, "pr-title")),
    status: text(section(html, "state state-[a-z]+")),
    stories: hrefIds(main, "story"),
    storyStatuses: badgeStatuses(main),
    done: counts === null ? -1 : Number(counts[1]),
    total: counts === null ? -1 : Number(counts[2]),
  };
}

/** trailmap's `/rfc/<id>`. */
export function extractTrailmapRfc(html: string): RfcPageFacts {
  const open = /<span class="count">(\d+) <span class="n">open/.exec(html);
  const done = /<span class="count">(\d+) <span class="n">done/.exec(html);
  // Scoped to the story box. trailmap renders the RFC's markdown on this same
  // page — ringo puts it on another tab — and a document that links to a story
  // would otherwise arrive as an extra row in the list.
  const box = between(html, '<div class="box-header">', '<h2 class="section-title">');
  return {
    title: text(section(html, "page-title")),
    // The pill prints the raw column; ringo's table is applied here so both
    // sides arrive in one vocabulary.
    status: rfcStateLabel(text(section(html, "state s-[a-z-]+"))),
    stories: hrefIds(box, "story"),
    storyStatuses: badgeStatuses(box),
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

/**
 * Every status badge in `html`, in order.
 *
 * Both sides spell a story row's status into the badge's own class — ringo as
 * `s-{{.Status}}` (webhook/rfcs.go), trailmap as `s-<%= shown %>`
 * (`shared/_status-badge`) — so the class is the value, and reading it needs
 * no assumption about which vocabulary the text beside it is in.
 */
export function badgeStatuses(html: string): string[] {
  return [...html.matchAll(/<span class="badge s-([a-z-]+)"/g)].map((match) => match[1]);
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
  // The list pages' superseded label, `&rarr; <id>` in the `.tse` against a
  // literal arrow in ringo's script.
  rarr: "→",
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
 *
 * Both sides are the SAME type, which is the point: the two extractors for one
 * page return one interface, so a field added to it is compared on both sides
 * or on neither, and never on one.
 */
export function diffFacts<T extends object>(a: T, b: T): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(a) as (keyof T & string)[]) {
    const left: unknown = a[key];
    const right: unknown = b[key];
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

/**
 * ONE ROW OF A LIST PAGE, as values rather than markup.
 *
 * `scripts/gate-ringo-lists.ts` compared membership, order and the tab counts
 * — the port's skeleton — and nothing a row SAYS. A port that listed exactly
 * the right stories in exactly the right order while inheriting the wrong
 * RFC's priority onto a row passed it. These extractors are what closes that:
 * the same trick as the show pages above, one interface per page, filled from
 * both sides' markup, diffed with {@link diffFacts}.
 *
 * What is deliberately NOT extracted is the status label, and there are now
 * TWO reasons rather than one.
 *
 * The first is presentational and was always here: #7 gave trailmap its own
 * vocabulary and its own badge (`shared/_status-badge`, `class="badge
 * s-<status>"`, against ringo's `class="label s-<status>"`), and the tabs are
 * links rather than repaints — differences the gate exists to tolerate.
 *
 * The second is SEMANTIC and is a stated divergence. trailmap decides which
 * status a page shows by one rule — the effective one,
 * `effectiveStoryStatus`, written out in `app/views/shared/_status-badge` —
 * whereas ringo decides it per page, from whichever dataset that page happens
 * to fetch. On the two LIST pages the two answers coincide and the gate proves
 * it without reading a badge: `/backlog`'s dataset is the CLI read model,
 * which carries the effective status, and it is that status the tab predicates
 * partition, so the tab a row lands on IS the comparison — a row trailmap
 * called `draft` and ringo called `ready` would sit on different tabs and go
 * red on membership. On `/rfcs` the only status a row states is inside the
 * progress bar, which this gate does not paint at all; see `RfcListRow`.
 *
 * So skipping the label costs the list gate nothing it could otherwise catch,
 * and the place where the effective status IS compared badge-for-badge is the
 * RFC SHOW page — `RfcPageFacts.storyStatuses` via {@link badgeStatuses},
 * effective on both sides, which is how trailmap#17 found the divergence this
 * rule closes.
 *
 * Skipped alongside it are the two labels only ringo draws: `needs refine`,
 * which trailmap does not port, and the over-LOC flag, which is drawn from a
 * `max_loc` this dataset never carries.
 */
/**
 * One row of `/rfcs`.
 *
 * The PROGRESS BAR is not a field here, and that is the one row value this
 * gate deliberately does not compare. ringo paints its bar from a
 * `story_status` map its server computes and this gate does not have —
 * `ringoRfcs` (gate-ringo-lists.ts) assembles ringo's rows from the RFC
 * columns and its vendored `core.StoryCounts`, and passes no `story_status`, so
 * ringo's side draws no segments to read. Its markup would not be readable
 * here anyway: ringo's segments are `<i class="ready">`, not a badge or a
 * label, so `labelsOf`'s `s-` skip never saw them.
 *
 * That matters more since trailmap's bar became effective-status
 * (`storyStatusCounts`, which now takes the parent RFC's status): a `ready`
 * story under a draft RFC is in the draft segment here, and whether ringo's
 * server agrees is UNKNOWN to this gate rather than proven equal. It is a
 * deliberate divergence under the one status rule
 * (`app/views/shared/_status-badge`) and it is uncompared, which is why it is
 * written down here instead of left to be inferred from an absent field. The
 * done/total headline beside the bar IS compared, as `progress`, and is
 * invariant under the override — `ready` and `draft` are both `open` to
 * `rfcStoryCounts`.
 */
export interface RfcListRow {
  id: string;
  /** The `P<n>` label's number, or "" when the row carries none. */
  priority: string;
  /** `<done>/<total>`, or "" when the RFC has no stories. */
  progress: string;
  /** Cluster labels, in the order the row draws them. */
  clusters: string[];
  /** The `→ <id>` label's target, or "". */
  supersededBy: string;
  /** The meta line's `by <owner>`, or "". */
  owner: string;
}

/** One backlog row. The inherited flags are the fields #15 ported and nothing checked. */
export interface StoryListRow {
  id: string;
  /** The ready-queue position as a number ("0" is `next up`), or "". */
  queue: string;
  /** The effective priority's number, or "". */
  priority: string;
  /** Whether that priority came from the parent RFC (ringo's `*`). */
  priorityInherited: boolean;
  /** The effective package names, in row order, without the inherited mark. */
  packages: string[];
  /** Whether those packages came from the parent RFC. */
  packagesInherited: boolean;
  /** The meta line's `~<n> LOC`, or "". */
  estLoc: string;
  /** Whether the row wears the icebox label. */
  icebox: boolean;
  /** The cluster label, or "". */
  cluster: string;
  /** The aside's PR number, or "". */
  pr: string;
  /** The meta line's `by <assignee>`, or "". */
  assignee: string;
}

/** One row's markup, split off `rows`' innerHTML by the class that opens each. */
function rowsOf(html: string, cls: string): string[] {
  const marker = `<div class="${cls}">`;
  return html
    .split(marker)
    .slice(1)
    .map((rest) => marker + rest);
}

/** One label span of a row's title line: its class suffix and its text. */
interface Label {
  /** The class attribute's tokens after `label`/`tag`. */
  classes: string[];
  text: string;
}

/**
 * The label spans of `titleline`, on either side.
 *
 * ringo spells them `<span class="label ...">` and trailmap `<span class="tag
 * ...">` — a rename, not a difference — so one pattern reads both and the
 * classification below never has to know which page it is looking at.
 */
function labelsOf(titleline: string): Label[] {
  const found: Label[] = [];
  for (const match of titleline.matchAll(
    /<span class="(?:label|tag)([^"]*)"[^>]*>([\s\S]*?)<\/span>/g,
  )) {
    const classes = match[1].trim().split(/\s+/).filter((c) => c !== "");
    // The status label, which the two pages deliberately spell differently.
    if (classes.some((c) => c.startsWith("s-"))) continue;
    // ringo-only labels trailmap does not draw: `needs refine`, and the
    // over-LOC flag, which needs a `max_loc` this dataset does not carry.
    if (classes.includes("stalled") || classes.includes("over")) continue;
    found.push({ classes, text: text(match[2]) });
  }
  return found;
}

/** The meta line's `by <name>`, which both sides write between middots. */
function metaBy(meta: string): string {
  const match = /(?:^|·)\s*by\s+([^·]+)/.exec(text(meta));
  return match === null ? "" : match[1].trim();
}

/**
 * The two markers a row's title line sits between, per side.
 *
 * `section` cannot be used for it: the title line HOLDS spans, and it is a
 * `<div>` on ringo's side and a `<span>` on trailmap's, so the first closing
 * tag is a label's rather than its own.
 */
interface RowMarkup {
  /** The tag that opens the title line, verbatim. */
  titleline: string;
  /** The class of the metadata sub-line, which is what the title line ends at. */
  meta: string;
  /** The class of the aside holding the PR link. */
  aside: string;
}

const RINGO_ROW: RowMarkup = { titleline: '<div class="titleline">', meta: "meta", aside: "pr" };
const TRAILMAP_ROW: RowMarkup = {
  titleline: '<span class="titleline">',
  meta: "row-meta",
  aside: "row-aside",
};

/** The row's title line: from its opening tag to the metadata line below it. */
function titlelineOf(row: string, markup: RowMarkup): string {
  return between(row, markup.titleline, `class="${markup.meta}"`);
}

/** One RFC list row, from either side's markup. */
function rfcRow(row: string, markup: RowMarkup): RfcListRow {
  const titleline = titlelineOf(row, markup);
  const facts: RfcListRow = {
    id: decodeURIComponent(hrefIds(titleline, "rfc")[0] ?? ""),
    priority: "",
    progress: "",
    clusters: [],
    supersededBy: "",
    owner: metaBy(section(row, markup.meta)),
  };
  for (const label of labelsOf(titleline)) {
    const priority = /^P(\d+)$/.exec(label.text);
    const progress = /^(\d+\/\d+) done$/.exec(label.text);
    if (priority !== null) facts.priority = priority[1];
    else if (progress !== null) facts.progress = progress[1];
    else if (label.text.startsWith("→")) facts.supersededBy = label.text.slice(1).trim();
    else facts.clusters.push(label.text);
  }
  return facts;
}

/** One backlog row, from either side's markup. */
function storyRow(row: string, markup: RowMarkup): StoryListRow {
  const titleline = titlelineOf(row, markup);
  const meta = text(section(row, markup.meta));
  const loc = /~(\d+) LOC/.exec(meta);
  const pr = /#(\d+)/.exec(section(row, markup.aside));
  const facts: StoryListRow = {
    id: decodeURIComponent(hrefIds(titleline, "story")[0] ?? ""),
    queue: "",
    priority: "",
    priorityInherited: false,
    packages: [],
    packagesInherited: false,
    estLoc: loc === null ? "" : loc[1],
    icebox: false,
    cluster: "",
    pr: pr === null ? "" : pr[1],
    assignee: metaBy(meta),
  };
  for (const label of labelsOf(titleline)) {
    const queue = /^#(\d+) in queue$/.exec(label.text);
    const priority = /^pri (\d+)(\*?)$/.exec(label.text);
    if (label.classes.includes("pkg")) {
      facts.packages.push(label.text.replace(/\*$/, ""));
      facts.packagesInherited ||= label.text.endsWith("*");
    } else if (label.classes.includes("icebox")) facts.icebox = true;
    else if (label.text === "next up") facts.queue = "0";
    else if (queue !== null) facts.queue = String(Number(queue[1]) - 1);
    else if (priority !== null) {
      facts.priority = priority[1];
      facts.priorityInherited = priority[2] === "*";
    } else facts.cluster = label.text;
  }
  return facts;
}

/** ringo's `/rfcs` rows, in page order. */
export function ringoRfcRows(html: string): RfcListRow[] {
  return rowsOf(html, "row").map((row) => rfcRow(row, RINGO_ROW));
}

/** trailmap's `/rfcs` rows, in page order. */
export function trailmapRfcRows(html: string): RfcListRow[] {
  return rowsOf(html, "item-row").map((row) => rfcRow(row, TRAILMAP_ROW));
}

/** ringo's `/backlog` rows, in page order. */
export function ringoStoryRows(html: string): StoryListRow[] {
  return rowsOf(html, "row").map((row) => storyRow(row, RINGO_ROW));
}

/** trailmap's `/backlog` rows, in page order. */
export function trailmapStoryRows(html: string): StoryListRow[] {
  return rowsOf(html, "item-row").map((row) => storyRow(row, TRAILMAP_ROW));
}
