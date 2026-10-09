# The fleet dashboard

`/dashboard` is ringo's root page (`webhook/dashboard.go:2348`) served by
trailmap: a controller, a `.tse` view and one script, instead of a 2,442-line
constant HTML string with a single `%s` in it.

No Go state moved. Every row on the page is process state ringo owns — tmux
panes, the spawn loop, webhook ingest — and RFC 0136's non-goals keep it there.
`Tracker.ServeEvents` (`dashboard.go:2383`) is untouched, and it is still what
fills the page in.

## Where the stream comes from

**The browser talks only to trailmap. trailmap talks to ringo.**

```text
browser --WebSocket /fleet/socket----> trailmap --GET /events (SSE)--> ringo
browser --POST /fleet/control/<path>--> trailmap --POST /<path>-------> ringo
browser --GET  /fleet/reviewers------> trailmap --GET /reviewer/list--> ringo
```

The page opens a WebSocket to trailmap. `FleetController#socket` takes the
connection from the server (`rack.hijack`), reads ringo's `/events`, and
forwards each event's JSON as one text message, unchanged. The page's buttons
post to `/fleet/control/<ringo's path>`, which `FleetController#control`
forwards, answering with ringo's status and text.

### Why trailmap is on the path after all

The first version of this page had the browser connect to ringo's `/events`
directly, and this document argued for it: a proxy puts trailmap on the
critical path of a stream it does not own, and holds a connection per viewer.
That never worked in deployment, and could not be made to without changing
ringo or weakening SSO:

- ringo is another origin (`ringo.deanoftech.com`), and its stream sends no
  CORS headers, so a page on trailmap's origin cannot read it.
- Routing ringo's paths under trailmap's hostname in nginx would work, but the
  SSO plugin authenticates only the main location block; a `/merge-pr` location
  added beside it is unauthenticated unless that is proven for each one.

Relaying through trailmap needs neither. Everything the browser reaches is on
trailmap's origin and under trailmap's authentication, including the controls,
which also get the framework's CSRF protection.

The costs the first version named are real and accepted: a trailmap restart
drops every viewer's socket (the page reconnects, with backoff), and trailmap
holds one upstream connection per viewer.

### Why a WebSocket and not a streamed response

Because of what happens when a viewer leaves. A streamed response body is
iterated by the server and never told that its reader has gone, so each closed
tab would leave trailmap reading ringo's stream for nobody until the process
restarted. A hijacked socket has a `close` event, and the relay aborts its
upstream read on it. That needs `rack.hijack`, which trails' handler offers on
upgrade requests (trails#8566), so the page's connection is a WebSocket.

It does not work under `pnpm dev`: the Vite dev server does not forward upgrade
requests to the application yet (trails story
`trails-dev-server-forwards-upgrade-requests-to-rack-handler`). Run in
production mode to see the page fill in.

### Configuration

| variable | meaning |
| --- | --- |
| `RINGO_BASE` | ringo's origin as the trailmap PROCESS reaches it. In deployment, `http://btwhooks.web:8080` on the `fleet` docker network. Unset, the page says it has no fleet data. |

The controls trailmap will forward are an allowlist, `FLEET_CONTROLS` in
`config/fleet.ts`: a path is added there when a button for it is added to the
page.

## The initial paint

The page paints empty and fills in on the first SSE frame, as ringo's does.
Server-rendering the first frame needs the PR rows to exist in `tasks.db`,
which is `move-tracker-state-into-the-database` — not this story.

## Configuration

| variable | meaning |
| --- | --- |
| `FLEET_REPO_PATHS` | The manual spawn control's repo list, as `owner/repo=/path/to/checkout`, comma-separated. ringo's `DashboardConfig.RepoPaths`. |
| `RINGO_BASE` | Above. |

## The reviewer of a PR

Each PR row's pane mini-table has two lines: the worker's pane, and under it
the reviewer's — its agent, its pane id, its status dot — exactly as ringo's
own rows read.

That second line cannot come from the stream. `Tracker.ServeEvents` carries no
reviewer, and ringo's own dashboard fetches `/reviewer/list` separately
(`dashboard.go:904`) for the same reason. So the page polls
`GET /fleet/reviewers` on trailmap every thirty seconds
(`FleetController#reviewers`), which relays ringo's `GET /reviewer/list`.
Thirty is ringo's own interval (`dashboard.go:2425`) and no faster: a reviewer
changes when a pane is spawned or dies, not between frames, and trailmap is a
hop ringo's page does not have — it relays once per viewer.

- The relay is read-only and narrower than the control relay: one fixed
  upstream path, no body, nothing to allowlist. It gives ringo
  `REVIEWERS_TIMEOUT_MS` (5s) and answers 502/503/504 as the others do.
- A failed poll keeps the last answer. A reviewer is a long-lived assignment,
  and blanking the rows because one request lost its race would say something
  false. The reason is named on the console once per transition, so a stale
  column cannot pass for a current one.
- Before the FIRST answer, and for as long as every poll fails, there is no
  reviewer line at all. The dash is a claim — it says nobody is reviewing this
  PR — and an unconfigured `RINGO_BASE` or an unreachable ringo would otherwise
  make the page assert that about every row at once, which is the page at its
  most confident exactly where it knows least. The list is `null` until an
  answer lands; an empty map is the different, real statement that ringo
  answered and nobody is reviewing anything.
- Only an array is a usable answer. `reviewersByKey` refuses anything else by
  naming its type, so a ringo answering `{}` is reported as that rather than as
  a generic iteration failure — and a body the page cannot read leaves the
  state unknown instead of empty.
- One poll at a time, with the browser's own deadline a poll interval wide.
  `REVIEWERS_TIMEOUT_MS` is the SERVER's patience; `fetch` has none of its own,
  so without both a hung relay would stack a request per tick on a page that
  already holds a socket per viewer.
- Three states, all of them a row: a live pane; a reviewer pinned to a PR
  whose pane has gone (the agent and a dash, because the assignment outlives
  the pane); and no reviewer at all. ringo offers a `+` in the last two that
  spawns or respawns one — this page is read-only and offers none, but it still
  says which of the three it is, because "nobody is reviewing this" is what a
  reader most wants to see. A merged PR keeps its line: the merge BUTTON goes
  because the action is gone, but the reviewer is information, and who reviewed
  a PR is most wanted while reading the merge — which is why ringo renders the
  line unconditionally too (`dashboard.go:1335`).
- ringo draws the agent's company logo here from its own `/claude-logo.svg`.
  trailmap carries no image assets, so the chip is the agent's name — the same
  information in the same space. `blocked_by_usage` marks the chip, not the
  dot: it is about the agent's quota, not the pane's momentary state.

## The live pane view

Every pane id on the fleet page links to `/panes/<n>` (`%42` is `/panes/42`):
that pane's screen, read-only, kept current. `paneLine` in `fleet-format.js`
makes the link, so every row type gets it from one place.

ringo owns tmux and does the capture; trailmap relays and renders. The page
polls `GET /fleet/pane/<n>/screen?have=<hash>` on trailmap every two seconds
(`FleetController#screen`), which asks ringo's `GET /pane/<n>/screen` over the
private network. Polling rather than the socket, because `have` makes the
usual answer — nothing changed — a few bytes, and the DOM is touched only when
ringo sends a new screen.

- The pane id is checked as digits (`isPaneId`) before a URL is built from it.
- The relay gives ringo `SCREEN_TIMEOUT_MS` (1.5s), inside the poll interval,
  and answers 502/503/504 as the control relay does.
- `html` in ringo's answer is its own rendering, already escaped, and is
  inserted as HTML. Everything else on the page goes in as text.
- A gone pane (`exists: false`) ends the polling and leaves the last screen
  up. An unreachable ringo is named in the header and retried; the screen is
  not blanked. A hidden tab and the Pause button both stop the polling.
- The terminal panel is dark in both themes: ringo's SGR colours assume it.

The page's decisions are in `pane-format.js` and tested there; `pane.js` is
the fetch and the assignments. Unlike the socket, it works under `pnpm dev`.
