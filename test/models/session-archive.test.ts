import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getHttpAsync, setEnv, type HttpServer } from "@blazetrails/ruby-compat";
import { SessionArchive, SessionArchiveUnavailable, type SessionArchiveRow } from "../../app/models/session-archive.ts";

const OPEN: SessionArchiveRow = {
  owner: "o", repo: "r", pr: 1, pane: "%1", opened_at: "2026-10-27T09:00:00-04:00", closed_at: "0001-01-01T00:00:00Z",
  transcripts: [
    { session_id: "s1", path: "a", bytes: 1, first_at: "", last_at: "", role: "agent", cwd: "/w", cost: 1 },
    { session_id: "s2", path: "b", bytes: 1, first_at: "", last_at: "", role: "agent", cwd: "/w", cost: 0.5 },
    { session_id: "s3", path: "c", bytes: 1, first_at: "", last_at: "", role: "reviewer", cost: 0.25 },
    { session_id: "s4", path: "d", bytes: 1, first_at: "", last_at: "", role: "reviewer" },
  ],
};
const CLOSED: SessionArchiveRow = {
  owner: "o", repo: "r", pr: 2, pane: "%2", opened_at: "2026-10-27T09:00:00Z", closed_at: "2026-10-27T10:30:00Z", reason: "merge",
};

let ringo: HttpServer;
let base = "";

beforeAll(async () => {
  const http = await getHttpAsync();
  ringo = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.url === "/api/sessions" ? JSON.stringify([OPEN, CLOSED]) : "not json");
  });
  await new Promise<void>((resolve) => ringo.listen(0, "127.0.0.1", () => resolve()));
  const address = ringo.address();
  base = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => ringo.close(() => resolve()));
});

afterEach(() => setEnv("RINGO_BASE", undefined));

describe("SessionArchive", () => {
  it("fromRow keeps ringo's row and casts its fields", () => {
    const a = SessionArchive.fromRow(CLOSED);
    expect(a.row).toBe(CLOSED);
    expect([a.owner, a.repo, a.pr, a.pane, a.branch, a.reason, a.paneLog, a.paneLogBytes, a.truncated]).toEqual(["o", "r", 2, "%2", "", "merge", "", 0, false]);
    expect(a.transcripts).toEqual([]);
  });

  it("all keeps ringo's order", async () => {
    setEnv("RINGO_BASE", base);
    expect((await SessionArchive.all()).map((a) => a.pr)).toEqual([1, 2]);
  });

  it("all raises SessionArchiveUnavailable without ringo, or on a non-JSON answer", async () => {
    await expect(SessionArchive.all()).rejects.toBeInstanceOf(SessionArchiveUnavailable);
    setEnv("RINGO_BASE", `${base}/x`);
    await expect(SessionArchive.all()).rejects.toThrow("not with the session archive as JSON");
  });

  it("forPr filters to one PR", async () => {
    setEnv("RINGO_BASE", base);
    expect((await SessionArchive.forPr({ owner: "o", repo: "r", pr: 2 })).map((a) => a.pane)).toEqual(["%2"]);
  });

  it("reads Go's zero time as open", () => {
    const open = SessionArchive.fromRow(OPEN);
    const closed = SessionArchive.fromRow(CLOSED);
    expect(open.isOpen()).toBe(true);
    expect(open.closedAt).toBeNull();
    expect(closed.isOpen()).toBe(false);
    expect(closed.closedAt?.toISOString()).toBe("2026-10-27T10:30:00.000Z");
    expect(open.openedAt.toISOString()).toBe("2026-10-27T13:00:00.000Z");
  });

  it("duration runs to now while open, to closedAt once closed", () => {
    expect(SessionArchive.fromRow(CLOSED).duration()).toBe(90 * 60_000);
    expect(SessionArchive.fromRow(OPEN).duration(new Date("2026-10-27T14:00:00Z"))).toBe(60 * 60_000);
  });

  it("cost sums the transcripts", () => {
    expect(SessionArchive.fromRow(OPEN).cost).toBe(1.75);
    expect(SessionArchive.fromRow(CLOSED).cost).toBe(0);
  });

  it("roleSplit counts runners by checkout, falling back to the session", () => {
    expect(SessionArchive.fromRow(OPEN).roleSplit()).toEqual({ agents: 1, reviewers: 2, passes: 4 });
  });
});
