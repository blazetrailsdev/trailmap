/**
 * `FleetController`: the control proxy against a stand-in ringo, and the socket
 * endpoint's refusals.
 *
 * NOT here: forgery protection on the control route. Controller tests run with
 * it off, and it is switched on by the application's boot, which a test cannot
 * do in-process. `scripts/smoke-boot.sh` asserts it against a production boot. The relay behind a successful handshake is tested over a
 * real socket in `test/lib/fleet-relay.test.ts`; a controller test case has no
 * connection to hijack.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { FleetController, SCREEN_TIMEOUT_MS } from "../../app/controllers/fleet-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

interface Received {
  url: string | undefined;
  contentType: string | undefined;
  body: string;
}

/** What the stand-in ringo says pane %42 shows. */
const SCREEN = {
  exists: true,
  status: "working",
  cwd: "/srv/worktrees/live-pane-view",
  html: '<span style="color:#3fb950">$ pnpm test</span>\n&lt;done&gt;',
  lines: 2,
  hash: "abc+/=1",
};

let ringo: HttpServer;
let ringoBaseUrl = "";
let received: Received[] = [];
let hung: (() => void)[] = [];

beforeAll(async () => {
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += new TextDecoder().decode(chunk);
    });
    req.on("end", () => {
      const contentType = req.headers["content-type"];
      received.push({
        url: req.url,
        contentType: typeof contentType === "string" ? contentType : undefined,
        body,
      });
      const url = new URL(req.url ?? "/", "http://ringo");
      if (url.pathname === "/pane/99/screen") {
        // A hung ringo: the request is taken and not answered while the test runs.
        hung.push(() => res.end());
        return;
      }
      if (url.pathname === "/pane/8/screen") {
        // A ringo that reports a gone pane under a 404 rather than the contract's 200.
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ exists: false }));
        return;
      }
      if (url.pathname === "/pane/9/screen") {
        // A ringo with no such endpoint: Go's own not-found, for every pane.
        res.writeHead(404);
        res.end("404 page not found\n");
        return;
      }
      if (url.pathname.startsWith("/pane/")) {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        if (url.pathname === "/pane/7/screen") {
          res.end(JSON.stringify({ exists: false }));
        } else if (url.searchParams.get("have") === SCREEN.hash) {
          res.end(JSON.stringify({ exists: true, status: "working", unchanged: true }));
        } else {
          res.end(JSON.stringify(SCREEN));
        }
        return;
      }
      if (body.includes("blocked")) {
        res.writeHead(409);
        res.end("blocked: CI is red");
      } else {
        res.writeHead(200);
        res.end("merged");
      }
    });
  });
  await new Promise<void>((resolve) => ringo.listen(0, "127.0.0.1", () => resolve()));
  const address = ringo.address();
  ringoBaseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => ringo.close(() => resolve()));
});

afterEach(() => {
  for (const release of hung.splice(0)) release();
  received = [];
  setEnv("RINGO_BASE", undefined);
});

async function control(path: string, body?: unknown) {
  const tc = await controllerTestCase(FleetController);
  await tc.post("control", {
    params: { path },
    ...(body === undefined ? {} : { body: JSON.stringify(body), as: "json" }),
  });
  return { status: tc.response.status, body: tc.response.body };
}

describe("FleetController#control", () => {
  it("forwards a listed control to ringo and answers with ringo's own status and text", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("merge-pr", { owner: "o", repo: "r", pr: 7 });

    expect(response).toEqual({ status: 200, body: "merged" });
    expect(received).toHaveLength(1);
    expect(received[0]!.url).toBe("/merge-pr");
    expect(received[0]!.contentType).toContain("application/json");
    expect(JSON.parse(received[0]!.body)).toEqual({ owner: "o", repo: "r", pr: 7 });
  });

  it("passes a refusal through, so the button can say why", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("merge-pr", { note: "blocked" });

    expect(response).toEqual({ status: 409, body: "blocked: CI is red" });
  });

  it("forwards a nested ringo path and a bodiless post", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    await control("spawnloop/dismiss-failed");

    expect(received.map((r) => [r.url, r.body])).toEqual([["/spawnloop/dismiss-failed", ""]]);
  });

  it("refuses a ringo endpoint the page has no button for, without calling ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await control("spawnloop/config", { enabled: true });

    expect(response.status).toBe(404);
    expect(received).toEqual([]);
  });

  it("says ringo is not configured rather than guessing where it is", async () => {
    expect((await control("merge-pr", {})).status).toBe(503);
  });

  it("answers 502 when ringo cannot be reached", async () => {
    setEnv("RINGO_BASE", "http://127.0.0.1:1");

    const response = await control("merge-pr", {});

    expect(response.status).toBe(502);
    expect(response.body).toContain("ringo is unreachable");
  });
});

async function screen(id: string, have?: string) {
  const tc = await controllerTestCase(FleetController);
  await tc.get("screen", { params: { id, ...(have === undefined ? {} : { have }) } });
  return tc.response;
}

describe("FleetController#screen", () => {
  it("relays ringo's screen for a pane, as JSON that is never cached", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await screen("42");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(SCREEN);
    expect(response.getHeader("Content-Type")).toContain("application/json");
    expect(response.getHeader("Cache-Control")).toContain("no-store");
    expect(received.map((r) => r.url)).toEqual(["/pane/42/screen"]);
  });

  it("passes the page's hash on, encoded, and relays ringo's unchanged answer", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await screen("42", SCREEN.hash);

    expect(JSON.parse(response.body)).toEqual({ exists: true, status: "working", unchanged: true });
    expect(received.map((r) => r.url)).toEqual(["/pane/42/screen?have=abc%2B%2F%3D1"]);
  });

  it("relays a gone pane as ringo says it: 200, and exists false", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await screen("7");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ exists: false });
  });

  it("hears a gone pane under a 404 too, so the page stops instead of retrying forever", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await screen("8");

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ exists: false });
  });

  it("does not mistake a ringo without the endpoint for a pane that has exited", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await screen("9");

    expect(response.status).toBe(404);
    expect(response.body).toContain("404 page not found");
  });

  it("refuses an overlong hash before a request is made of it", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    expect((await screen("42", "a".repeat(128))).status).toBe(200);
    received = [];
    expect((await screen("42", "a".repeat(129))).status).toBe(400);
    expect(received).toEqual([]);
  });

  it("refuses anything but digits before a request is made of it", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    for (const id of ["%42", "4x", "..", "42?have=1", "-1", "", "12345678901", "٤٢"]) {
      expect((await screen(id)).status, id).toBe(400);
    }
    expect(received).toEqual([]);
  });

  it("says ringo is not configured rather than guessing where it is", async () => {
    expect((await screen("42")).status).toBe(503);
  });

  it("answers 502 when ringo cannot be reached", async () => {
    setEnv("RINGO_BASE", "http://127.0.0.1:1");

    const response = await screen("42");

    expect(response.status).toBe(502);
    expect(response.body).toContain("ringo is unreachable");
  });

  it("answers 504 when ringo takes the request and does not answer", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    const started = Date.now();

    const response = await screen("99");

    expect(response.status).toBe(504);
    expect(response.body).toContain("ringo did not answer");
    // Polled every two seconds, so the wait has to end inside one interval.
    expect(SCREEN_TIMEOUT_MS).toBeLessThan(2000);
    expect(Date.now() - started).toBeLessThan(2000 + 1000);
  });
});

describe("FleetController#socket", () => {
  it("refuses a handshake from another origin, as Action Cable does, before reaching ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    const tc = await controllerTestCase(FleetController, { Origin: "https://evil.example" });

    await tc.get("socket");

    expect(tc.response.status).toBe(404);
    expect(received).toEqual([]);
  });

  it("refuses a handshake that names no origin at all", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    const tc = await controllerTestCase(FleetController);

    await tc.get("socket");

    expect(tc.response.status).toBe(404);
  });

  it("refuses a same-origin request that is not a WebSocket handshake", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);
    const tc = await controllerTestCase(FleetController, { Origin: "http://test.host" });

    await tc.get("socket");

    expect(tc.response.status).toBe(426);
  });

  it("says ringo is not configured before it takes a connection", async () => {
    const tc = await controllerTestCase(FleetController, { Origin: "http://test.host" });

    await tc.get("socket");

    expect(tc.response.status).toBe(503);
  });
});
