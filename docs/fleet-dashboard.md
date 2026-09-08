# The fleet dashboard

`/dashboard` is ringo's root page (`webhook/dashboard.go:2348`) served by
trailmap: a controller, a `.tse` view and one script, instead of a 2,442-line
constant HTML string with a single `%s` in it.

No Go state moved. Every row on the page is process state ringo owns — tmux
panes, the spawn loop, webhook ingest — and RFC 0136's non-goals keep it there.
`Tracker.ServeEvents` (`dashboard.go:2383`) is untouched, and it is still what
fills the page in.

## Where the SSE connection points

**The browser connects to ringo's `/events` directly.** trailmap never proxies
it.

The alternative was for trailmap to proxy the stream so the page had one
origin. It was rejected: a proxy would put trailmap on the critical path of a
stream it does not own, so a trailmap restart would blank the page the fleet
watches all day, and trailmap would have to hold an open connection per viewer
for data it never reads. The stream stays Go's, end to end.

The endpoint is configuration rather than a constant, because trailmap and
ringo are not the same process:

| variable | default | meaning |
| --- | --- | --- |
| `RINGO_EVENTS_URL` | `/events` | Where the page opens its `EventSource`, and the origin its one control POST (`/spawn`) is resolved against. |

The default is same-origin, which is correct when the SSO reverse proxy routes
both processes under one host. That is the supported deployment.

A cross-origin value needs more from ringo than it looks. The page opens the
stream with `withCredentials` — it has to, or the SSO cookie does not travel
and the request is bounced to the login page — and a credentialed CORS request
is subject to the stricter rules: `Access-Control-Allow-Origin: *` is
**rejected**, so the response must echo trailmap's specific origin and also
carry `Access-Control-Allow-Credentials: true`. Get one of those wrong and the
failure is silent: `EventSource` fires `onerror` with no detail, and the page
sits empty with a red events dot. (This is not theory — it is exactly what
happened the first time these were shot against a stand-in stream.)

`ServeEvents` sets no CORS headers at all today, and this story does not add
them, since it must not touch that handler. A CORS allowance on ringo is a
change to make in ringo, if a separate host is ever wanted.

## The initial paint

The page paints empty and fills in on the first SSE frame, as ringo's does.
Server-rendering the first frame needs the PR rows to exist in `tasks.db`,
which is `move-tracker-state-into-the-database` — not this story.

## Configuration

| variable | meaning |
| --- | --- |
| `FLEET_REPO_PATHS` | The manual spawn control's repo list, as `owner/repo=/path/to/checkout`, comma-separated. ringo's `DashboardConfig.RepoPaths`. |
| `RINGO_EVENTS_URL` | Above. |
