/**
 * `DeploysController` against a stand-in ringo: the history in ringo's order,
 * one run's log relayed verbatim, and the relay's failures.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { DeploysController, type DeployRow } from "../../app/controllers/deploys-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/** What the stand-in ringo's `/api/deploys` holds, newest first as ringo keeps it. */
const RUNS: DeployRow[] = [
  {
    id: "trailmap-200", app: "trailmap", repo: "blazetrailsdev/trailmap", branch: "main", sha: "6df3fec",
    message: "feat: fingerprint production assets", status: "running", exitCode: 0,
    started: "2026-10-22T19:00:00Z", seconds: 42, logFile: "/home/dean/.btwhooks/panes/pane-12.log",
  },
  {
    id: "ringo-100", app: "ringo", repo: "deanmarano/btwebooks", branch: "main", sha: "c3f9198",
    message: "fix(reviewers): <reconcile>", status: "failed", exitCode: 1,
    started: "2026-10-22T18:00:00Z", seconds: 125, error: "git push exited 1",
  },
];

let ringo: HttpServer;
let ringoBaseUrl = "";
let asked: string[] = [];

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://ringo");
    if (url.pathname === "/api/deploys") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(RUNS));
    } else if (url.pathname === "/finished/api/deploys") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(RUNS.slice(1)));
    } else if (url.pathname === "/bad-json/api/deploys") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json</html>");
    } else if (url.pathname === "/proxy-down/api/deploys") {
      res.writeHead(502, { "content-type": "text/html" });
      res.end("<html><body>Bad Gateway from nginx</body></html>");
    } else if (url.pathname === "/deploys/log" && url.searchParams.get("id") === "ringo-100") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("-----> Building ringo\n ! push rejected\n");
    } else {
      res.writeHead(404);
      res.end("unknown deploy\n");
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
  setEnv("RINGO_BASE", undefined);
  Trails.application!.config.x.deploys.logsDir = undefined;
});

async function get(action: string, params: Record<string, string> = {}) {
  const tc = await controllerTestCase(DeploysController);
  await tc.get(action, { params });
  return tc.response;
}

describe("DeploysController#index", () => {
  it("renders ringo's runs in ringo's order, escaped, each linking its log", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("index");

    expect(response.status).toBe(200);
    expect(asked).toEqual(["/api/deploys"]);
    const body = response.body;
    expect(body.indexOf("trailmap-200")).toBeLessThan(body.indexOf("ringo-100"));
    expect(body).toContain('href="/deploys/log?id=ringo-100"');
    expect(body).toContain("s-deploy-failed");
    expect(body).toContain("git push exited 1");
    expect(body).toContain("2m 5s");
    expect(body).toContain("&lt;reconcile&gt;");
    expect(body).not.toContain("<reconcile>");
  });

  it("re-reads itself while a run is running, with a config element and no inline script", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const body = (await get("index")).body;
    expect(body).toContain('<div id="deploysConfig" hidden data-refresh-ms="5000"></div>');
    expect(body).toMatch(/<script src="[^"]*deploys[^"]*\.js" type="module"><\/script>/);
    expect(body).not.toMatch(/<script>|<script type="module">/);
    // Each row's log expands in place, naming the capture ringo recorded.
    expect(body).toContain('<details class="deploy-log" data-run="trailmap-200">');
    expect(body).toContain('data-src="/deploys/log?id=trailmap-200"');
  });

  it("stays still once every run has finished", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/finished`);

    expect((await get("index")).body).not.toContain("deploysConfig");
  });

  it("says ringo is not configured rather than guessing where it is", async () => {
    const response = await get("index");

    expect(response.status).toBe(200);
    expect(response.body).toContain("no ringo origin is configured");
  });

  it("says ringo is unreachable when it cannot be reached", async () => {
    setEnv("RINGO_BASE", "http://127.0.0.1:1");

    expect((await get("index")).body).toContain("ringo is unreachable");
  });

  it("says ringo answered something other than JSON, not that it is unreachable", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/bad-json`);

    const body = (await get("index")).body;
    expect(body).toContain("not with the deploy history as JSON");
    expect(body).not.toContain("unreachable");
  });

  it("reports ringo's error status without its body", async () => {
    setEnv("RINGO_BASE", `${ringoBaseUrl}/proxy-down`);

    const body = (await get("index")).body;
    expect(body).toContain("ringo answered 502");
    expect(body).not.toContain("Bad Gateway from nginx");
  });
});

describe("DeploysController#log", () => {
  it("relays one run's log verbatim, as plain text", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("log", { id: "ringo-100" });

    expect(response.status).toBe(200);
    expect(response.body).toBe("-----> Building ringo\n ! push rejected\n");
    expect(asked).toEqual(["/deploys/log?id=ringo-100"]);
  });

  it("passes ringo's 404 for an unknown run through", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("log", { id: "nope&x=1" });

    expect(response.status).toBe(404);
    expect(asked).toEqual(["/deploys/log?id=nope%26x%3D1"]);
  });

  it("reads a run's own capture off the mounted pane-log directory, not ringo's relay", async () => {
    Trails.application!.config.x.deploys.logsDir = "test/fixtures/deploy-logs/";
    setEnv("RINGO_BASE", ringoBaseUrl);

    const raw = await get("log", { id: "trailmap-200" });
    expect(raw.status).toBe(200);
    expect(raw.body).toBe("-----> Building trailmap\n");
    // The history is read to find the file; the log itself is not relayed.
    expect(asked).toEqual(["/api/deploys"]);
  });

  it("opens only the file the run names, whatever the request adds", async () => {
    Trails.application!.config.x.deploys.logsDir = "test/fixtures/deploy-logs";
    setEnv("RINGO_BASE", ringoBaseUrl);

    // ringo-100 names no file, so a `file` parameter reaches nothing on disk.
    const response = await get("log", { id: "ringo-100", file: "pane-13.log" });
    expect(response.body).toBe("-----> Building ringo\n ! push rejected\n");
    expect(asked).toEqual(["/api/deploys", "/deploys/log?id=ringo-100"]);
  });

  it("refuses a request with no id without calling ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("log");
    expect(response.status).toBe(404);
    expect(response.getHeader("Cache-Control")).toContain("no-store");
    expect(asked).toEqual([]);
  });

  it("answers 503 with no ringo and 502 when ringo cannot be reached", async () => {
    expect((await get("log", { id: "ringo-100" })).status).toBe(503);
    setEnv("RINGO_BASE", "http://127.0.0.1:1");
    expect((await get("log", { id: "ringo-100" })).status).toBe(502);
  });
});
