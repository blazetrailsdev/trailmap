/**
 * `SessionsController` against a stand-in ringo: the index in ringo's order
 * and columns, one PR's archives, the JSON relayed in ringo's shape, and the
 * relay's failures.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { SessionsController } from "../../app/controllers/sessions-controller.ts";
import type { SessionArchiveRow } from "../../app/models/session-archive.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/** What the stand-in ringo's `/api/sessions` holds, in ringo's `List` order. */
const ARCHIVES: SessionArchiveRow[] = [
  {
    owner: "blazetrailsdev", repo: "trails", pr: 9001, pane: "%42", branch: "fix-<arel>",
    cwd: "/w/fix-arel", opened_at: "2026-10-27T09:00:00Z", closed_at: "0001-01-01T00:00:00Z",
    pane_log: "panes/42.log", pane_log_bytes: 4_404_019,
    transcripts: [
      { session_id: "aaaaaaaa-1111-2222", path: "t/a.jsonl", bytes: 2048, first_at: "2026-10-27T09:00:00Z", last_at: "2026-10-27T10:00:00Z", role: "agent", cwd: "/w/fix-arel", user_turns: 7, cost: 1.5 },
      { session_id: "bbbbbbbb", path: "t/b.jsonl", bytes: 512, first_at: "2026-10-27T10:00:00Z", last_at: "2026-10-27T10:05:00Z", role: "reviewer", cwd: "/r/pr-9001", cost: 0.25 },
      { session_id: "cccccccc", path: "t/c.jsonl", bytes: 512, first_at: "2026-10-27T10:10:00Z", last_at: "2026-10-27T10:15:00Z", role: "reviewer", cwd: "/r/pr-9001", cost: 0.25 },
    ],
  },
  {
    owner: "blazetrailsdev", repo: "trailmap", pr: 80, pane: "%7", opened_at: "2026-10-20T08:00:00-04:00",
    closed_at: "2026-10-20T11:05:00-04:00", reason: "merge", truncated: true,
  },
];

/** ringo's `/api/sessions/status` in pilot mode, with captures no PR claimed. */
const PILOT_STATUS = {
  mode: "pilot",
  note: "pilot mode: capturing 2 more spawn(s) and 1 hand-enrolled pane(s). Every other agent is ignored. Measure disk here before setting SESSION_ARCHIVE=on.",
  unclaimed_pane_logs: 3,
  unclaimed_pane_log_bytes: 5 * 1024 * 1024,
};

/** ringo's `/api/sessions/timeline` for trails#9001: an event, a wait, an event. */
const TIMELINE = { events: 2, gap_floor: "1m", quiet_floor: "5m", elapsed: "1h30m", working: "1h00m", waiting: "30m", rows: [
    { kind: "session", when: "Oct 27 09:00", title: "agent <session>", ran: "1h00m", active: "40m", meta: ["7 turns · $1.50"] },
    { wait: "⋯ waiting 30m — PR sat unreviewed" },
    { kind: "review", when: "Oct 27 10:30", title: "review 1", body_html: "<p>looks <strong>good</strong></p>", open: true },
  ] };

let timelineAnswer: unknown = TIMELINE;
let ringo: HttpServer;
let ringoBaseUrl = "";
let asked: string[] = [];

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    if (req.url === "/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ARCHIVES));
    } else if (req.url === "/api/sessions/timeline?owner=blazetrailsdev&repo=trails&pr=9001") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(timelineAnswer));
    } else if (req.url === "/api/sessions/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(PILOT_STATUS));
    } else if (req.url === "/empty/api/sessions/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mode: "on", note: "", unclaimed_pane_logs: 0, unclaimed_pane_log_bytes: 0 }));
    } else if (req.url === "/empty/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("null\n");
    } else {
      res.writeHead(502, { "content-type": "text/html" });
      res.end("<html><body>Bad Gateway from nginx</body></html>");
    }
  });
  await new Promise<void>((resolve) => ringo.listen(0, "127.0.0.1", () => resolve()));
  const address = ringo.address();
  ringoBaseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => ringo.close(() => resolve()));
});

afterEach(() => {
  asked = [];
  timelineAnswer = TIMELINE;
  setEnv("RINGO_BASE", undefined);
});

async function get(action: string, params: Record<string, string> = {}) {
  const tc = await controllerTestCase(SessionsController);
  await tc.get(action, { params });
  return tc.response;
}

describe("SessionsController#index", () => {
  it("renders ringo's archives in ringo's order with ringo's columns", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("index");

    expect(response.status).toBe(200);
    expect([...asked].sort()).toEqual(["/api/sessions", "/api/sessions/status"]);
    const body = response.body;
    for (const column of ["PR", "Branch", "Pane", "Opened", "Duration", "State", "Sessions", "Pane log", "Cost"]) {
      expect(body).toContain(`<th>${column}</th>`);
    }
    expect(body).toContain("2 recorded");
    expect(body.indexOf("trails#9001")).toBeLessThan(body.indexOf("trailmap#80"));
    expect(body).toContain('href="/sessions/blazetrailsdev/trails/9001"');
    expect(body).toContain("fix-&lt;arel&gt;");
    expect(body).not.toContain("fix-<arel>");
    expect(body).toContain('<span class="session-pill live">open</span>');
    expect(body).toContain('<span class="session-pill">merge</span>');
    expect(body).toContain("truncated");
    // One agent checkout, one reviewer checkout that made two passes.
    expect(body).toMatch(/1 <span class="session-role agent">agent<\/span>\s*·\s*1 <span class="session-role reviewer">reviewer<\/span>\s*<span class="muted">· 3 passes<\/span>/);
    expect(body).toContain("4.2 MB");
    expect(body).toContain("$2.00");
    expect(body).toContain("Oct 20 08:00");
    expect(body).toContain("3h05m");
  });

  it("says nothing is archived for ringo's null list", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/empty`);

    const response = await get("index");

    expect(response.status).toBe(200);
    expect(response.body).toContain("Nothing archived yet.");
  });

  it("shows ringo's archive mode note and its unclaimed pane captures", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const body = String((await get("index")).body);

    expect(body).toContain(`mode: <strong>pilot</strong> — ${PILOT_STATUS.note}`);
    expect(body).toContain(
      "3 unclaimed pane capture(s), 5.0 MB — panes armed at spawn that ended before linking to a PR. Kept and compressed, never deleted.",
    );
  });

  it("shows neither note when the archive is on and every capture is claimed", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/empty`);

    const body = String((await get("index")).body);

    expect(body).not.toContain("mode: <strong>");
    expect(body).not.toContain("unclaimed pane capture");
  });

  it("shows neither note when ringo cannot say", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/proxy-down`);

    const body = String((await get("index")).body);

    expect(body).not.toContain("mode: <strong>");
    expect(body).not.toContain("unclaimed pane capture");
  });

  it("says ringo is not configured rather than guessing where it is", async () => {
    const response = await get("index");

    expect(response.status).toBe(200);
    expect(response.body).toContain("no ringo origin is configured");
  });

  it("reports ringo's status, not a proxy's error page", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/proxy-down`);

    const response = await get("index");

    expect(response.body).toContain("ringo answered 502");
    expect(response.body).not.toContain("Bad Gateway from nginx");
  });
});

describe("SessionsController#show", () => {
  it("renders one PR's archives with each transcript row", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("show", { owner: "blazetrailsdev", repo: "trails", pr: "9001" });

    expect(response.status).toBe(200);
    const body = response.body;
    expect(body).toContain("blazetrailsdev/trails#9001");
    expect(body).toContain("1 archived pane(s)");
    expect(body).toContain("pane %42 · fix-&lt;arel&gt;");
    for (const column of ["Session", "Role", "First", "Last", "Turns", "Size", "Cost"]) {
      expect(body).toContain(`<th>${column}</th>`);
    }
    expect(body).toContain("aaaaaaaa-111…");
    expect(body).toContain("2.0 KB");
    expect(body).toContain("$1.50");
    expect(body).toContain("cwd /w/fix-arel");
    expect(body).not.toContain("trailmap#80");
  });

  it("renders ringo's timeline above the cards, in ringo's order", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const body = (await get("show", { owner: "blazetrailsdev", repo: "trails", pr: "9001" })).body;

    expect(body).toContain("2 events, oldest first");
    expect(body).toContain('<div class="tl-ev k-session">');
    expect(body).toContain("agent &lt;session&gt;");
    expect(body).toContain('<span class="tl-dur tl-active">active 40m</span>');
    expect(body).toContain('<details class="tl-body" open><summary>hide</summary><div class="md"><p>looks <strong>good</strong></p></div></details>');
    const order = ["Timeline", "agent &lt;session&gt;", "⋯ waiting 30m", "review 1", "pane %42"].map((text) => body.indexOf(text));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("keeps the cards when ringo cannot give the timeline", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const body = (await get("show", { owner: "blazetrailsdev", repo: "trailmap", pr: "80" })).body;

    expect(body).toContain("pane %7");
    expect(body).not.toContain('class="tl-totals"');
  });

  it("keeps the cards when ringo's timeline has no rows", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    timelineAnswer = { error: "nope" };

    const response = await get("show", { owner: "blazetrailsdev", repo: "trails", pr: "9001" });

    expect(response.status).toBe(200);
    expect(response.body).toContain("pane %42");
    expect(response.body).not.toContain('class="tl-totals"');
  });

  it("says a PR with no archive has none", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("show", { owner: "blazetrailsdev", repo: "trails", pr: "1" });

    expect(response.status).toBe(200);
    expect(response.body).toContain("No archive recorded for this PR.");
  });
});

describe("SessionsController#api", () => {
  it("relays ringo's index in ringo's JSON shape", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("api");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(ARCHIVES);
  });

  it("answers ringo's failure as a status, not an empty list", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/proxy-down`);

    const response = await get("api");

    expect(response.status).toBe(502);
    expect(response.body).toBe("ringo answered 502");
  });
});
