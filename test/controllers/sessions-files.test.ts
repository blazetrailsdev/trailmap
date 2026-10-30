/**
 * `/sessions/file`, `/sessions/transcript` and `/sessions/pane` against a
 * stand-in ringo: each relayed or replayed, each refusal of a bad `p` made
 * before ringo is asked, and the pane replay bounded to the log's tail.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { PANE_VIEW_MAX_BYTES, SessionsController, TRANSCRIPT_MAX_BYTES } from "../../app/controllers/sessions-controller.ts";
import { archivePathProblem } from "../../lib/archive-read.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/** A prompt, one Bash call answered 12 s later with markup in its output, and a reply. */
const TRANSCRIPT = [
  `{"type":"user","timestamp":"2026-08-26T14:00:00Z","sessionId":"0123456789abcdef","cwd":"/w/trails","message":{"role":"user","content":"port <the> thing"}}`,
  `{"type":"assistant","timestamp":"2026-08-26T14:00:01Z","message":{"role":"assistant","model":"claude-opus-5","content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls","description":"List files"}}]}}`,
  `{"type":"user","timestamp":"2026-08-26T14:00:13Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_1","content":"<script>x</script>"}]}}`,
  `{"type":"assistant","timestamp":"2026-08-26T14:01:30Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}`,
  `{"type":"attachment","timestamp":"2026-08-26T14:01:31Z"}`,
].join("\n");

const PANE_LOG = "plain \x1b[31mred <b>\x1b[0m\r\nsecond row\r\n";
/** Bigger than the replay bound, ending in a line the tail must keep. */
const BIG_LOG = `${"x".repeat(80)}\r\n`.repeat((PANE_VIEW_MAX_BYTES / 82) * 1.25) + "THE END\r\n";

/** Past the parse bound: the session, then bookkeeping lines that run on beyond it. */
const LONG_TRANSCRIPT =
  TRANSCRIPT +
  `\n{"type":"attachment","timestamp":"2026-08-26T14:02:00Z","pad":"${"x".repeat(1000)}"}`.repeat(
    Math.ceil((TRANSCRIPT_MAX_BYTES * 1.25) / 1060),
  );

/**
 * Replaying or parsing megabytes through core.wasm runs synchronously at about
 * 110 ms/MB (lib/ringo-core.ts): ~0.5 s alone, but several times that under a
 * full parallel `pnpm test`, past vitest's 5 s default. The bound is the
 * point of these tests, so the input stays over it and the clock gets room.
 */
const WASM_REPLAY_TIMEOUT_MS = 30_000;

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
    } else if (url.pathname === "/sessions/file" && p === "trails/9001/long.jsonl") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(LONG_TRANSCRIPT);
    } else if (url.pathname === "/sessions/file" && p === "trails/9001/a.jsonl") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(TRANSCRIPT);
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
  it("draws the session ringo's reader reads back", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const response = await get("transcript", { p: "trails/9001/a.jsonl" });
    const body = String(response.body);

    expect(response.status).toBe(200);
    expect(asked).toEqual(["/sessions/file?p=trails%2F9001%2Fa.jsonl"]);
    expect(body).toContain("session 0123456789ab…");
    expect(body).toContain('<div class="n">1m</div><div class="l">wall clock</div>');
    expect(body).toContain("Tool mix");
    expect(body).toContain("Where the time went");
    expect(body).toContain("prompt 1 · 14:00:00");
    expect(body).toContain("port &lt;the&gt; thing");
    expect(body).toContain('<span class="tx-tool-sum">List files</span>');
    expect(body).toContain("12.0s slow");
    expect(body).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(body).toContain("1 bookkeeping events");
    expect(body).not.toContain("longer than trailmap reads");
  });

  it(
    "parses only the head of a transcript past the bound",
    async () => {
      setEnv("RINGO_BASE", ringoBaseUrl);

      const response = await get("transcript", { p: "trails/9001/long.jsonl" });
      const body = String(response.body);

      expect(response.status).toBe(200);
      expect(body).toContain("port &lt;the&gt; thing");
      expect(body).toContain("showing its first 4.0 MB");
    },
    WASM_REPLAY_TIMEOUT_MS,
  );

  it("links only to pages trailmap serves", async () => {
    setEnv("RINGO_BASE", ringoBaseUrl);

    const body = String((await get("transcript", { p: "trails/9001/a.jsonl" })).body);

    // ringo's own page carried ringo's nav: /tasks, /velocity, /cost, /crons,
    // /logs, none of them a trailmap route. The layout's nav is trailmap's.
    const page = body.slice(body.indexOf('<main class="site-main">'));
    const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
    expect(hrefs).toEqual(["/sessions/file?p=trails%2F9001%2Fa.jsonl"]);
    expect(body).toContain('<nav class="nav">');
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

  it(
    "replays only the tail of a log past the bound",
    async () => {
      setEnv("RINGO_BASE", ringoBaseUrl);

      const response = await get("pane", { p: "trails/9001/big.log" });

      expect(response.status).toBe(200);
      expect(response.body).toContain("THE END");
      expect(response.body).toContain("showing the last 2.0 MB");
    },
    WASM_REPLAY_TIMEOUT_MS,
  );

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
