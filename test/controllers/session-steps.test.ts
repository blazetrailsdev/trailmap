/**
 * `SessionsController#steps` (`GET /fleet/transcript`): a PR's newest worker
 * transcript as the dashboard's session log (RFC 0232), against a stand-in
 * ringo. The newest-worker choice, paging newest first, and a PR with no
 * archive.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { SessionsController, stepsPage, transcriptSteps, type SessionStep } from "../../app/controllers/sessions-controller.ts";
import type { SessionArchiveRow } from "../../app/models/session-archive.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

const transcript = (prompt: string, tools: number): string =>
  [
    `{"type":"user","timestamp":"2026-11-14T10:00:00Z","message":{"content":"${prompt}"}}`,
    ...Array.from({ length: tools }, (_, i) =>
      [
        `{"type":"assistant","timestamp":"2026-11-14T10:00:0${i % 10}Z","message":{"content":[{"type":"tool_use","id":"t${i}","name":"Read","input":{"file_path":"f${i}.ts"}}]}}`,
        `{"type":"user","timestamp":"2026-11-14T10:00:0${i % 10}Z","message":{"content":[{"type":"tool_result","tool_use_id":"t${i}","content":"ok"}]}}`,
      ].join("\n"),
    ),
  ].join("\n") + "\n";

const ARCHIVES: SessionArchiveRow[] = [
  {
    owner: "blazetrailsdev", repo: "trails", pr: 9001, pane: "%42", opened_at: "2026-11-14T09:00:00Z",
    transcripts: [
      { session_id: "a", path: "trails/9001/old.jsonl", bytes: 1, first_at: "2026-11-14T09:00:00Z", last_at: "2026-11-14T09:30:00Z", role: "agent" },
      { session_id: "b", path: "trails/9001/new.jsonl", bytes: 1, first_at: "2026-11-14T10:00:00Z", last_at: "2026-11-14T11:00:00Z", role: "agent" },
      { session_id: "c", path: "trails/9001/review.jsonl", bytes: 1, first_at: "2026-11-14T11:00:00Z", last_at: "2026-11-14T12:00:00Z", role: "reviewer" },
    ],
  },
  { owner: "blazetrailsdev", repo: "trails", pr: 9001, pane: "%43", opened_at: "2026-11-13T09:00:00Z" },
];

const FILES: Record<string, string> = {
  "trails/9001/old.jsonl": transcript("old", 1),
  "trails/9001/new.jsonl": transcript("newest", 3),
  "trails/9001/review.jsonl": transcript("review", 1),
};

let ringo: HttpServer;
let ringoBaseUrl = "";
let asked: string[] = [];

beforeAll(async () => {
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    const url = new URL(req.url ?? "/", "http://ringo");
    if (url.pathname === "/api/sessions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ARCHIVES));
    } else if (url.pathname === "/sessions/file" && FILES[url.searchParams.get("p") ?? ""]) {
      res.writeHead(200);
      res.end(FILES[url.searchParams.get("p")!]);
    } else {
      res.writeHead(404);
      res.end("no such file");
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

async function steps(params: Record<string, string>) {
  setEnv("RINGO_BASE", ringoBaseUrl);
  const tc = await controllerTestCase(SessionsController);
  await tc.get("steps", { params });
  return tc.response;
}

const PR = { owner: "blazetrailsdev", repo: "trails", pr: "9001" };

describe("SessionsController#steps", () => {
  it("reads the newest worker transcript, never a reviewer's", async () => {
    const response = await steps(PR);
    const body = JSON.parse(response.body) as { path: string; archives: number; total: number; steps: SessionStep[] };

    expect(response.status).toBe(200);
    expect(body.path).toBe("trails/9001/new.jsonl");
    expect(body.archives).toBe(2);
    expect(asked).toContain("/sessions/file?p=trails%2F9001%2Fnew.jsonl");
    expect(asked.some((a) => a.includes("review"))).toBe(false);
  });

  it("answers the steps newest first: the prompt is the oldest", async () => {
    const body = JSON.parse((await steps(PR)).body) as { total: number; steps: SessionStep[] };

    expect(body.total).toBe(4);
    expect(body.steps.map((s) => s.i)).toEqual([3, 2, 1, 0]);
    expect(body.steps[3]).toMatchObject({ kind: "user", text: "newest" });
    expect(body.steps[0]).toMatchObject({ kind: "tool", tool: "Read", text: "f2.ts" });
  });

  it("pages with before and limit", async () => {
    const body = JSON.parse((await steps({ ...PR, before: "3", limit: "2" })).body) as { steps: SessionStep[] };

    expect(body.steps.map((s) => s.i)).toEqual([2, 1]);
  });

  it("answers no steps for a PR with no archive", async () => {
    const body = JSON.parse((await steps({ ...PR, pr: "1" })).body) as { archives: number; path: null; steps: [] };

    expect(body).toEqual({ archives: 0, path: null, steps: [], total: 0 });
  });

  it("is never cached", async () => {
    expect(String((await steps(PR)).getHeader("Cache-Control"))).toContain("no-store");
  });

  it("refuses a request that names no pull request", async () => {
    expect((await steps({ owner: "o", repo: "r", pr: "x" })).status).toBe(400);
    expect((await steps({ ...PR, before: "-1" })).status).toBe(400);
  });
});

describe("stepsPage", () => {
  const all = Array.from({ length: 450 }, (_, i) => ({ i, at: "", kind: "text" as const, text: "" }));

  it("takes at most the limit, newest first, before the step named", () => {
    expect(stepsPage(all, null, 200).map((s) => s.i).slice(0, 2)).toEqual([449, 448]);
    expect(stepsPage(all, null, 200)).toHaveLength(200);
    expect(stepsPage(all, 50, 200).map((s) => s.i)).toEqual(Array.from({ length: 50 }, (_, k) => 49 - k));
    expect(stepsPage(all, 0, 200)).toEqual([]);
  });
});

describe("transcriptSteps", () => {
  it("lists each prompt then its steps, leaving thinking out", () => {
    const steps = transcriptSteps({
      Turns: [{ Prompt: "go", At: "t0", Steps: [
        { Kind: "thinking", At: "t1", Text: "hmm", Tool: null },
        { Kind: "text", At: "t2", Text: "done", Tool: null },
        { Kind: "tool", At: "t3", Text: "", Tool: { Name: "Bash", Summary: "ls", IsError: true } },
      ] }],
    } as never);

    expect(steps).toEqual([
      { i: 0, at: "t0", kind: "user", text: "go" },
      { i: 1, at: "t2", kind: "text", text: "done" },
      { i: 2, at: "t3", kind: "tool", text: "ls", tool: "Bash", error: true },
    ]);
  });
});
