/**
 * `/sessions/file`, `/sessions/transcript` and `/sessions/pane` against a
 * stand-in ringo: each relayed or replayed, each refusal of a bad `p` made
 * before ringo is asked, and the pane replay bounded to the log's tail.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { PANE_VIEW_MAX_BYTES, SessionsController } from "../../app/controllers/sessions-controller.ts";
import { archivePathProblem } from "../../lib/archive-read.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

const PANE_LOG = "plain \x1b[31mred <b>\x1b[0m\r\nsecond row\r\n";
/** Bigger than the replay bound, ending in a line the tail must keep. */
const BIG_LOG = `${"x".repeat(80)}\r\n`.repeat((PANE_VIEW_MAX_BYTES / 82) * 1.25) + "THE END\r\n";

let ringo: HttpServer;
let ringoBaseUrl = "";
let asked: string[] = [];

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://ringo");
    const p = url.searchParams.get("p");
    if (url.pathname === "/sessions/file" && p === "trails/9001/pane-42.log.gz") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(PANE_LOG);
    } else if (url.pathname === "/sessions/file" && p === "trails/9001/big.log") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(BIG_LOG);
    } else if (url.pathname === "/sessions/transcript" && p === "trails/9001/a.jsonl") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>fix arel</h1>");
    } else {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found\n");
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
});

async function get(action: string, params: Record<string, string> = {}) {
  const tc = await controllerTestCase(SessionsController);
  await tc.get(action, { params });
  return tc.response;
}

describe("archivePathProblem", () => {
  it("accepts a path the archive writes", () => {
    expect(archivePathProblem("blazetrailsdev/trails/9001/pane-42.log.gz")).toBeNull();
  });

  it("refuses a traversal", () => {
    expect(archivePathProblem("trails/../../etc/passwd")).toContain("escapes the archive root");
  });

  it("refuses a dotfile", () => {
    expect(archivePathProblem("trails/.env")).toContain("dotfile");
  });

  it("refuses an absolute path", () => {
    expect(archivePathProblem("/etc/passwd")).toContain("empty segment");
  });

  it("refuses a backslash separator", () => {
    expect(archivePathProblem("trails\\..\\x")).toContain("character");
  });

  it("refuses a missing path", () => {
    expect(archivePathProblem("")).toBe("missing p");
  });
});

describe("SessionsController#file", () => {
  it("relays one file as ringo serves it", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("file", { p: "trails/9001/pane-42.log.gz" });

    expect(response.status).toBe(200);
    expect(response.body).toBe(PANE_LOG);
    expect(response.getHeader("Content-Disposition")).toBe('inline; filename="pane-42.log"');
  });

  it("refuses a bad path without asking ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    for (const p of ["../index.json", "trails/.git", "/abs", "a\\b"]) {
      expect((await get("file", { p })).status).toBe(400);
    }
    expect(asked).toEqual([]);
  });

  it("passes ringo's 404 through", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("file", { p: "trails/9001/gone.log" });

    expect(response.status).toBe(404);
    expect(response.body).toBe("not found");
  });
});

describe("SessionsController#transcript", () => {
  it("relays ringo's transcript page", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("transcript", { p: "trails/9001/a.jsonl" });

    expect(response.status).toBe(200);
    expect(response.body).toBe("<h1>fix arel</h1>");
    expect(asked).toEqual(["/sessions/transcript?p=trails%2F9001%2Fa.jsonl"]);
  });
});

describe("SessionsController#pane", () => {
  it("replays the log through ringo's renderer, escaped", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("pane", { p: "trails/9001/pane-42.log.gz" });

    expect(response.status).toBe(200);
    expect(response.body).toContain("red &lt;b&gt;");
    expect(response.body).toContain("<span style=");
    expect(response.body).toContain("second row");
    expect(response.body).not.toContain("showing the last");
  });

  it("replays only the tail of a log past the bound", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("pane", { p: "trails/9001/big.log" });

    expect(response.status).toBe(200);
    expect(response.body).toContain("THE END");
    expect(response.body).toContain("showing the last 2.0 MB");
  });

  it("sends a transcript to the transcript page", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("pane", { p: "trails/9001/a.jsonl" });

    expect(response.status).toBe(302);
    expect(response.getHeader("Location")).toContain("/sessions/transcript?p=trails%2F9001%2Fa.jsonl");
    expect(asked).toEqual([]);
  });

  it("refuses a traversal without asking ringo", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    expect((await get("pane", { p: "../../etc/passwd" })).status).toBe(400);
    expect(asked).toEqual([]);
  });
});
