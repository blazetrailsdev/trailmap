/**
 * THE DASHBOARD'S END-TO-END CHECK: the real page, in a real browser, against
 * a stand-in for ringo. Run it through `scripts/dashboard-e2e.sh`, which boots
 * trailmap and a headless Chrome and hands this their addresses.
 *
 * The unit tests decide what each control sends and shows; this is the only
 * check of the wiring between them — the click listener, the stream through
 * the WebSocket relay, the `data-` attributes reaching `fetch`, the CSRF token
 * and the control allowlist. It plays ringo, records every POST, and asserts
 * each control's request and what its button says afterwards. Chrome is driven
 * over its DevTools protocol with the platform's `fetch` and `WebSocket`.
 */
import { env, exit, getFs, getHttpAsync } from "@blazetrails/ruby-compat";
import { STYLESHEET, boxRules, collisionsInList } from "./class-collisions.js";

const APP = String(env.E2E_APP);
const PR = { owner: "o", repo: "r", pr: 7, title: "A pull request", branch: "a-branch" };
const ENVELOPE = {
  // #8's reviewer is pinned and its pane gone, so its `+` is a respawn.
  prs: [PR, { ...PR, pr: 8, pane: "%4" }],
  spawns: [{ story_id: "a-story", branch: "b-branch", status: "failed" }],
  fixers: [{ owner: "o", repo: "r", consecutive_red: 1, red_sha: "abc1234" }],
};
const ANSWERS: Record<string, [number, string]> = {
  "/merge-pr": [200, "merged"],
  "/worker/spawn": [409, "no worktree for a-branch"],
  "/spawnloop/dismiss": [200, ""],
  "/spawnloop/dismiss-failed": [200, ""],
  "/ci-fixer/spawn": [200, "ok"],
  "/broadcast": [200, JSON.stringify({ pane_count: 3, sent: [{}, {}, {}] })],
  "/reviewer/assign": [200, "ok"],
  "/pause": [200, JSON.stringify({ paused: true })],
  "/refresh-usage": [200, "{}"],
};
let reviewers: Array<Record<string, unknown>> = [{ ...PR, pr: 8, agent: "copilot" }];
let ciRed = 1;
// ringo's usage answer: the pause button and the scraper pill draw from it.
const usage = { manualPause: false, watchConnected: false, lastCheckTime: "" };
const READS: Record<string, () => unknown> = {
  "/reviewer/list": () => reviewers,
  "/reviewer/config": () => ({ next_reviewer: "codex" }),
  "/broadcast/targets": () => ({ all: 3, "ci-red": ciRed }),
  "/usage-status": () => usage,
};
const posts: Array<[string, unknown]> = [];

const ringo = (await getHttpAsync()).createServer((req, res) => {
  const path = req.url ?? "/";
  if (path === "/events") {
    // One frame, then held open as ringo holds it: nothing repaints the rows.
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify(ENVELOPE)}\n\n`);
  } else if (req.method !== "POST") {
    res.writeHead(READS[path] ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(READS[path]?.() ?? null));
  } else {
    let body = "";
    req.on("data", (chunk) => (body += new TextDecoder().decode(chunk)));
    req.on("end", () => {
      const sent = body === "" ? null : JSON.parse(body);
      posts.push([path, sent]);
      // What ringo would then report: the reviewer's pane, and nothing left failing CI.
      if (path === "/reviewer/assign") {
        reviewers = [...reviewers.filter((r) => r.pr !== sent.pr), { ...PR, pr: sent.pr, agent: "codex", pane_id: `%9${sent.pr}` }];
      }
      if (sent?.target === "ci-red") ciRed = 0;
      if (path === "/pause") usage.manualPause = sent.paused;
      if (path === "/refresh-usage") usage.watchConnected = true;
      const [status, text] = ANSWERS[path] ?? [404, "not a ringo endpoint"];
      // A broadcast is held a moment, so the page's in-flight state can be seen.
      setTimeout(() => {
        res.writeHead(status);
        res.end(text);
      }, path === "/broadcast" ? 500 : 0);
    });
  }
});
await new Promise<void>((resolve) => ringo.listen(Number(env.E2E_RINGO_PORT), "127.0.0.1", resolve));

/** Poll `probe` until it answers something truthy; a throw counts as "not yet". */
async function until<T>(what: string, probe: () => Promise<T | false | null | undefined>): Promise<T> {
  // A minute: a cold runner has taken more than thirty seconds to start Chrome.
  for (let attempt = 0; attempt < 600; attempt++) {
    const value = await probe().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dashboard-e2e: timed out waiting for ${what}`);
}

await until("trailmap to boot", async () => (await fetch(`${APP}/up`)).ok);
const tab = await until("chrome", async () => {
  const opened = await fetch(`${env.E2E_CDP}/json/new?${APP}/dashboard`, { method: "PUT" });
  return (await opened.json()) as { webSocketDebuggerUrl: string };
});
const devtools = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => devtools.addEventListener("open", resolve));

let calls = 0;
function evaluate(expression: string): Promise<unknown> {
  const id = ++calls;
  return new Promise((resolve, reject) => {
    const answer = (event: MessageEvent): void => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      devtools.removeEventListener("message", answer);
      if (message.result.exceptionDetails) reject(new Error(`${expression}: threw in the page`));
      else resolve(message.result.result.value);
    };
    devtools.addEventListener("message", answer);
    devtools.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}

const button = (action: string, pr = ""): string =>
  `document.querySelector('button[data-action="${action}"]${pr && `[data-pr="${pr}"]`}')`;
const byId = (id: string): string => `document.getElementById("${id}")`;
/** Type a broadcast and press Enter, as the box's own key handler takes it. */
const enter = (ctrlKey: boolean): string =>
  `${byId("bcastMsg")}.value = " rebase "; ` +
  `${byId("bcastMsg")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: ${ctrlKey}, bubbles: true }))`;
const sentNote = `${byId("bcastNote")}.textContent === "sent to 3 panes" && ${byId("bcastMsg")}.value === ""`;

/**
 * `on` is the button; `act` what is done to the page (a click of `on` unless
 * given); `after` what must come true of `on` (as `b`) once the POST settled.
 */
const bothHeld = `${byId("bcastAll")}.disabled && ${byId("bcastCIRed")}.disabled`;
/** `during`, when given, must hold while ringo has the POST and has not answered. */
const CASES: Array<{ name: string; on: string; act?: string; post: [string, unknown]; during?: string; after: string }> = [
  { name: "merge", on: button("merge"), post: ["/merge-pr", { owner: "o", repo: "r", pr: 7 }],
    after: `b.textContent === "merged" && b.disabled && b.title === "merged"` },
  { name: "add worker, refused by ringo", on: button("add-worker"),
    post: ["/worker/spawn", { owner: "o", repo: "r", pr: 7, branch: "a-branch" }],
    after: `b.textContent === "fail" && !b.disabled && b.title === "no worktree for a-branch"` },
  { name: "dismiss", on: button("dismiss"), post: ["/spawnloop/dismiss", { branch: "b-branch" }], after: "b.disabled" },
  { name: "clear failed", on: button("clear-failed"), post: ["/spawnloop/dismiss-failed", null], after: "b.disabled" },
  { name: "respawn fixer", on: button("respawn-fixer"), post: ["/ci-fixer/spawn", { owner: "o", repo: "r" }],
    after: `b.textContent === "spawned" && b.disabled` },
  { name: "broadcast to all, by Enter", on: byId("bcastAll"), act: enter(false),
    post: ["/broadcast", { message: "rebase", target: "all" }], during: bothHeld,
    after: `!b.disabled && !${byId("bcastCIRed")}.disabled && b.textContent === "all (3)" && ${sentNote}` },
  // ringo then reports nobody failing CI, and the audience's button goes.
  { name: "broadcast to CI red, by Ctrl+Enter", on: byId("bcastCIRed"), act: enter(true),
    post: ["/broadcast", { message: "rebase", target: "ci-red" }], during: bothHeld,
    after: `b.style.display === "none" && !${byId("bcastAll")}.disabled && ${sentNote}` },
  { name: "pause", on: byId("pauseBtn"), post: ["/pause", { paused: true }],
    after: `!b.disabled && b.textContent === "Resume" && b.dataset.paused === "true"` },
  { name: "refresh usage from the scraper pill", on: byId("watchPill"), post: ["/refresh-usage", null],
    after: `!b.disabled && ${byId("watchDot")}.className === "connected on"` },
  // Last, because a reviewer's refresh repaints the rows: the `+` gives way to the pane.
  { name: "add reviewer", on: button("add-reviewer", "7"),
    post: ["/reviewer/assign", { owner: "o", repo: "r", pr: 7, agent: "codex", respawn: false }],
    after: `!b && !!document.querySelector('a.pane-link[href="/panes/97"]')` },
  { name: "respawn a reviewer whose pane has gone", on: button("add-reviewer", "8"),
    post: ["/reviewer/assign", { owner: "o", repo: "r", pr: 8, agent: "codex", respawn: true }],
    after: `!b && !!document.querySelector('a.pane-link[href="/panes/98"]')` },
];

// Both `+` buttons and the live counts on the page means the stream and all three polls have landed.
await until("the page to draw", () =>
  evaluate(
    `!!${button("add-worker")} && !!${button("add-reviewer", "8")} && ${byId("bcastCIRed")}.textContent === "CI red (1)" && ` +
      `${byId("pauseBtn")}.textContent === "Pause" && ${byId("watchDot")}.className === "connected off"`,
  ),
);

// An empty message sends nothing and puts the cursor in the box.
await evaluate(`${byId("bcastMsg")}.value = "  "; ${byId("bcastMsg")}.blur(); ${byId("bcastAll")}.click(); true`);
await new Promise((resolve) => setTimeout(resolve, 300));
if (posts.length > 0 || !(await evaluate(`document.activeElement === ${byId("bcastMsg")}`))) {
  throw new Error("dashboard-e2e: an empty broadcast did not focus the message box");
}
console.log("ok  broadcast, empty message focuses the box");

// A declined confirm sends nothing and leaves the button as it was.
await evaluate(`window.alert = () => {}; window.confirm = () => false; ${button("merge")}.click(); true`);
await new Promise((resolve) => setTimeout(resolve, 500));
if (posts.length > 0 || (await evaluate(`${button("merge")}.disabled`))) {
  throw new Error("dashboard-e2e: a declined confirm still acted");
}
console.log("ok  merge, confirm declined");
await evaluate("window.confirm = () => true; true");

for (const { name, on, act, post, during, after } of CASES) {
  const before = posts.length;
  await evaluate(`${act ?? `${on}.click()`}; true`);
  const sent = await until(`${name}: its POST`, async () => posts[before]);
  if (JSON.stringify(sent) !== JSON.stringify(post)) {
    throw new Error(`dashboard-e2e: ${name} sent ${JSON.stringify(sent)}, not ${JSON.stringify(post)}`);
  }
  if (during && !(await evaluate(during))) throw new Error(`dashboard-e2e: ${name}: not so in flight: ${during}`);
  await until(`${name}: the button afterwards`, () => evaluate(`(() => { const b = ${on}; return ${after}; })()`));
  console.log(`ok  ${name}`);
}
// The class lists the page drew at run time, against the source scan's rule
// (test/assets/class-collisions.test.ts): rows, cards and toggled classes included.
const rules = boxRules(await getFs().readFile(STYLESHEET, "utf8"));
const drawn = (await evaluate(`[...document.querySelectorAll("[class]")].map((e) => e.getAttribute("class"))`)) as string[];
const collided = [...new Set(drawn.flatMap((list) => collisionsInList(list, rules)))];
if (drawn.length < 50 || collided.length) {
  throw new Error(`dashboard-e2e: ${drawn.length} class lists drawn, colliding: ${collided.join(", ") || "none"}`);
}
console.log(`ok  ${drawn.length} drawn class lists, none wearing two boxes`);
console.log(`dashboard-e2e: ${CASES.length + 3} cases — every control posts what ringo expects and says what happened`);
exit(0);
