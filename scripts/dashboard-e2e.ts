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
import { env, exit, getHttpAsync } from "@blazetrails/ruby-compat";

const APP = String(env.E2E_APP);
const PR = { owner: "o", repo: "r", pr: 7, title: "A pull request", branch: "a-branch" };
const ENVELOPE = { prs: [PR], spawns: [{ story_id: "a-story", branch: "b-branch", status: "failed" }] };
const ANSWERS: Record<string, [number, string]> = {
  "/merge-pr": [200, "merged"],
  "/worker/spawn": [409, "no worktree for a-branch"],
  "/spawnloop/dismiss": [200, ""],
  "/broadcast": [200, JSON.stringify({ pane_count: 3, sent: [{}, {}, {}] })],
  "/reviewer/assign": [200, "ok"],
};
let reviewers: unknown[] = [];
const READS: Record<string, () => unknown> = {
  "/reviewer/list": () => reviewers,
  "/reviewer/config": () => ({ next_reviewer: "codex" }),
  "/broadcast/targets": () => ({ all: 3, "ci-red": 0 }),
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
      posts.push([path, body === "" ? null : JSON.parse(body)]);
      if (path === "/reviewer/assign") reviewers = [{ ...PR, agent: "codex", pane_id: "%9" }];
      const [status, text] = ANSWERS[path] ?? [404, "not a ringo endpoint"];
      res.writeHead(status);
      res.end(text);
    });
  }
});
await new Promise<void>((resolve) => ringo.listen(Number(env.E2E_RINGO_PORT), "127.0.0.1", resolve));

/** Poll `probe` until it answers something truthy; a throw counts as "not yet". */
async function until<T>(what: string, probe: () => Promise<T | false | null | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 300; attempt++) {
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

const button = (action: string): string => `document.querySelector('button[data-action="${action}"]')`;
const byId = (id: string): string => `document.getElementById("${id}")`;

/** `click` is the button, `after` what must come true of it (as `b`) once the POST has settled. */
const CASES = [
  { name: "merge", click: button("merge"), post: ["/merge-pr", { owner: "o", repo: "r", pr: 7 }],
    after: `b.textContent === "merged" && b.disabled && b.title === "merged"` },
  { name: "add worker, refused by ringo", click: button("add-worker"),
    post: ["/worker/spawn", { owner: "o", repo: "r", pr: 7, branch: "a-branch" }],
    after: `b.textContent === "fail" && !b.disabled && b.title === "no worktree for a-branch"` },
  { name: "dismiss", click: button("dismiss"), post: ["/spawnloop/dismiss", { branch: "b-branch" }], after: "b.disabled" },
  { name: "broadcast", before: `${byId("bcastMsg")}.value = " rebase "`, click: byId("bcastAll"),
    post: ["/broadcast", { message: "rebase", target: "all" }],
    after: `!b.disabled && b.textContent === "all (3)" && ${byId("bcastCIRed")}.style.display === "none" && ` +
      `${byId("bcastNote")}.textContent === "sent to 3 panes" && ${byId("bcastMsg")}.value === ""` },
  // Last, because its refresh repaints the rows: the `+` gives way to the reviewer's pane.
  { name: "add reviewer", click: button("add-reviewer"),
    post: ["/reviewer/assign", { owner: "o", repo: "r", pr: 7, agent: "codex", respawn: false }],
    after: `!b && !!document.querySelector('a.pane-link[href="/panes/9"]')` },
];

// Both `+` buttons and the live count on the page means the stream and all three polls have landed.
await until("the page to draw", () =>
  evaluate(`!!${button("add-worker")} && !!${button("add-reviewer")} && ${byId("bcastAll")}.textContent === "all (3)"`),
);
await evaluate("window.confirm = () => true; window.alert = () => {}; true");

for (const { name, before, click, post, after } of CASES) {
  if (before) await evaluate(before);
  await evaluate(`${click}.click()`);
  const sent = await until(`${name}: its POST`, async () => posts.find(([path]) => path === post[0]));
  if (JSON.stringify(sent) !== JSON.stringify(post)) {
    throw new Error(`dashboard-e2e: ${name} sent ${JSON.stringify(sent)}, not ${JSON.stringify(post)}`);
  }
  await until(`${name}: the button afterwards`, () => evaluate(`(() => { const b = ${click}; return ${after}; })()`));
  console.log(`ok  ${name}`);
}
console.log(`dashboard-e2e: ${CASES.length} controls post what ringo expects and say what happened`);
exit(0);
