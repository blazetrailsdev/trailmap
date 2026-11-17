# Style guide: look like GitHub

trailmap is a tool for people who spend their day on GitHub. Its pages should
feel like one more tab of it: the same colours, the same type, the same
components, in the same places. Familiarity is the feature. A reader should
never have to learn what a mark means here, because they already learned it
there.

**The rule: if GitHub has a component for it, use GitHub's. If it does not,
compose one out of GitHub's parts. Do not invent a new one.** A stage stepper,
a spinning ring, a tinted row edge and a serif wordmark are all things a
reader has to decode. A label, an octicon, a counter and a box are not.

GitHub's design system is [Primer](https://primer.style). When this guide is
silent, look at how github.com draws the nearest thing and copy it.

Everything below lives in `app/assets/stylesheets/application.css`, which the
Rails twin shares through a symlink.

## Colour

The tokens on `:root` are Primer's values, light by default, dark under
`prefers-color-scheme`, and `data-theme` on `<html>` forces either. Use a
token, never a hex value in a rule.

| Token | Light | Dark | Primer role | Use |
| --- | --- | --- | --- | --- |
| `--bg`, `--surface` | `#ffffff` | `#0d1117` | canvas default | the page, and a box's body |
| `--surface-2` | `#f6f8fa` | `#151b23` | canvas subtle | box headers, the nav, hover, footers |
| `--line` | `#d1d9e0` | `#3d444d` | border default | every border and divider |
| `--ink` | `#1f2328` | `#f0f6fc` | fg default | text, titles |
| `--ink-2`, `--ink-3` | `#59636e` | `#9198a1` | fg muted | meta lines, counts, placeholders |
| `--accent` | `#0969da` | `#4493f8` | accent | links, focus rings, a selected item |
| `--green` / `--action` | `#1a7f37` | `#3fb950` / `#238636` | success | open, passing, the primary button |
| `--red` | `#d1242f` | `#f85149` | danger | failing, closed, destructive |
| `--yellow-ink` | `#7d4e00` | `#d29922` | attention | pending, warnings (as text) |
| `--purple` | `#8250df` | `#ab7df8` | done | merged |
| `--tab` | `#fd8c73` | same | underline nav | the current page's underline |

Colour carries GitHub's meaning and no other: green is open or passing,
purple is merged, red is failing or destructive, yellow is pending, grey is
draft, blue is a link or a selection. Never use a colour for decoration, and
never use a state colour for something that is not that state.

`--green-bg`, `--red-bg`, `--yellow-bg` and `--accent-bg` are the subtle
fills that sit under their text colour (a flash, a selected toggle).
`test/assets/palette-contrast.test.ts` holds every text token to 4.5:1 and
every stage colour to 3:1 on both grounds in both themes.

The six session stages map onto those meanings (`--st-*`): Drafting is grey
(a draft), Self review is attention, Reviewer convergence is orange (changes
requested), Getting CI green is accent (in progress), Ready to merge is
success, Merged is done.

## Type

GitHub's system stack, and nothing loaded from a font service:

- `--font-ui`: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
  Helvetica, Arial, sans-serif`
- `--font-mono`: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
  "Liberation Mono", monospace`

| Size | Weight | Use |
| --- | --- | --- |
| 14px / 1.5 | 400 | body, controls, buttons (500) |
| 16px | 600 | a row's title |
| 14px | 600 | a box header's title |
| 12px | 400 | meta lines, labels (500), counters (500), key hints |

Three sizes. No size between them, no uppercase, no letter-spacing, no serif.
Sentence case everywhere, as GitHub writes it: "Needs you", not "NEEDS YOU".
Monospace is for code, ids a person would paste, and terminal output only.

## Shape and space

- **Radius**: 6px on boxes, buttons, inputs and menu rows; 12px on an overlay;
  `2em` on labels and counters. Nothing else.
- **Borders, not shadows.** A box is a 1px `--line` border. Only an overlay
  (the command palette) casts a shadow. A button carries a hairline.
- **Spacing** on a 4px grid: 4, 8, 12, 16, 24. A box pads 16px; a row 10-12px
  by 16px.
- **Height**: a control is 32px, a small one 28px.
- No tinted rows, no coloured row edges, no gradients, no blur.

## Icons

[Octicons](https://primer.style/octicons), the 16px set, inlined as SVG and
filled with `currentColor`. `ICONS` in `app/assets/javascripts/fleet-format.js`
holds the ones in use; add to it by copying the path from the octicons package
rather than drawing one. A new concept takes the octicon GitHub already uses
for the nearest concept:

| Octicon | Means |
| --- | --- |
| `git-pull-request` (green) | an open pull request |
| `git-pull-request-draft` (grey) | a draft pull request, and only that |
| `git-merge` (purple) | merged |
| `issue-opened` (green) | an open story: an agent with no pull request yet |
| `pencil` | the drafting stage |
| `check` / `x` / `dot-fill` | CI passing / failing / running |
| `eye`, `code-review`, `sync`, `check-circle` | the self-review, review, CI and ready stages |

## Components

| GitHub component | Class | Notes |
| --- | --- | --- |
| Header | `.nav` | `--surface-2` bar; the signpost icon at 24px and the wordmark, then weight-600 links with a grey hover; the current page (`isCurrentPage`, an exact match) underlined in `--tab` and marked `aria-current`. The icon is the only artwork on a page and the only place its oranges appear |
| Box | `.box`, `.card`, `.sessions` | 1px border, 6px radius; its header (`.box-header`, `.repo-head`, a folding card's `summary`) is `--surface-2` with a bottom border and a 600 title |
| Box row | `.session`, `.row`, `.item-row` | divided by a 1px top border; hover is `--surface-2` |
| Button | `.btn` | see below |
| Form control | `.ctl` | 32px, 1px border, 6px radius; focus is a 2px `--accent` outline |
| Label | `.Label`, `.flag`, `.badge` | a 12px outlined pill. `.Label.stage.st-*` is a stage; `.flag` is attention, `.flag.bad` danger; `.badge.s-*` is a story or RFC status (`shared/_status-badge`), the same Label hued by status |
| Counter | `.Counter` | a count beside a title |
| State | `.state` | the solid pill at the top of a show page, hued like its `.badge`: ready and active are open (green), done and closed are merged (purple), claimed, in progress and blocked are pending (attention), draft is grey |
| Flash | `.strip` | a `--yellow-bg` banner inside the thing it is about |
| Progress bar | `.meter` | 8px, 6px radius, on a neutral track |
| Toggle switch | `.switch` | rounded-rectangle track, `--accent` when on |
| Key hint | `kbd` | `--surface-2` with a bottom inset line |
| Overlay | `.palette` | the command palette, below |

### Buttons

A button is a bordered grey control: `--btn-bg` fill, 1px `--btn-border`,
6px radius, weight 500, and a hairline shadow. It darkens on hover
(`--btn-hover`), sinks on press (`--btn-active`, the shadow turns inward), and
shows a 2px `--accent` outline on keyboard focus.

- `.btn`: the default. Most buttons are this.
- `.btn-primary` (also `.btn-green`): the green one. **At most one per group**,
  and it goes last, on the right: Spawn, Merge, Save. It is the thing the
  group exists to do.
- `.btn-red`: destructive or hard to undo. Red text on the default fill,
  filled red on hover, as GitHub's danger button is. Close story, Sunset RFC.
- `.btn-sm`: 28px, for a button inside a row or a dense line.

In a sidebar (`.rfc-actions` on the story and RFC pages) buttons run full
width, one per line: the primary first, destructive ones last, and a verb that
takes a reason keeps its field directly above its button.

There is no yellow or blue button. A second action beside a primary is a
default button. A button's label is a verb in sentence case.

### A list row

A row in a list reads like a pull request in GitHub's list, left to right:

1. a **state octicon**, coloured by state;
2. the **title**, 16px weight 600, `--ink`, turning `--accent` on hover, with
   the CI mark and any labels beside it;
3. under it a **meta line**, 12px `--ink-2`, parts joined by ` · `: the
   reference (`trails#10156`), then what last happened;
4. on the right, what a reader scans for: a **stage label**, a count, the
   row's **actions** as small buttons (the primary one last), and how long ago
   it changed. A row offers an action only when it can be taken now.

State is said once, by the leading icon and the stage label. The row itself
stays white.

### The command palette

`⌘K` opens it, as it does on GitHub. It is the one modal the app has; search,
Broadcast, Spawn and messaging a session are modes of it rather than dialogs
of their own.

- An overlay 640px wide, 12px radius, over a `rgba(31, 35, 40, .5)` backdrop.
- A search row: the `search` octicon, a 16px borderless input, an `esc` hint.
- Scope toggles (`.chip`): outlined pills; the pressed one is `--accent` text
  on `--accent-bg`.
- Results grouped under a 12px weight-600 heading, groups divided by a line.
  Each result is an octicon, a 14px title and a 12px muted line. The selected
  one is neutral grey with GitHub's 4px `--accent` bar at its left edge.
- A `--surface-2` footer of key hints.
- A mode's own action is a `.btn-primary`, beside the field it submits.
- Below 700px it is a full-screen sheet with a Cancel link.

## Adopting this on a page

The tokens, type, buttons, controls and palette apply everywhere through the
shared stylesheet. The dashboard (`/dashboard`) is the first page laid out to
this guide. When bringing another page over:

1. Replace anything invented with the component above that GitHub would use.
2. Use only the three type sizes and the radii listed.
3. Take the page's screenshots in light, dark and at 390px.
4. A field is `.ctl`; there is no `.input`.
