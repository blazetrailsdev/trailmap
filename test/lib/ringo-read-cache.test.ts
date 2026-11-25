import { afterEach, describe, expect, it } from "vitest";
import { cachedRingoRead, clearRingoReadCache, FRESH_MS, STALE_MS } from "../../lib/ringo-read-cache.ts";

afterEach(() => clearRingoReadCache());

const ok = (text: string) => ({ ok: true, status: 200, text });

describe("cachedRingoRead", () => {
  it("serves a fresh answer without asking again, and asks once it ages", async () => {
    let t = 0;
    let calls = 0;
    const load = async () => ok(`n${++calls}`);
    expect((await cachedRingoRead("k", load, () => t)).text).toBe("n1");
    t = FRESH_MS - 1;
    expect((await cachedRingoRead("k", load, () => t)).text).toBe("n1");
    t = FRESH_MS;
    expect((await cachedRingoRead("k", load, () => t)).text).toBe("n2");
  });

  it("shares one request among callers that arrive while it is out", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const load = async () => {
      calls++;
      await gate;
      return ok("shared");
    };
    const all = Promise.all([cachedRingoRead("k", load), cachedRingoRead("k", load), cachedRingoRead("k", load)]);
    release();
    expect((await all).map((a) => a.text)).toEqual(["shared", "shared", "shared"]);
    expect(calls).toBe(1);
  });

  it("stands in the last good answer when ringo times out or 5xxs, within STALE_MS", async () => {
    let t = 0;
    await cachedRingoRead("k", async () => ok("good"), () => t);
    t = FRESH_MS + 1;
    expect((await cachedRingoRead("k", async () => { throw new Error("timeout"); }, () => t)).text).toBe("good");
    expect((await cachedRingoRead("k", async () => ({ ok: false, status: 502, text: "bad" }), () => t)).text).toBe("good");
    t = STALE_MS + 1;
    await expect(cachedRingoRead("k", async () => { throw new Error("timeout"); }, () => t)).rejects.toThrow("timeout");
  });

  it("passes a 4xx through and never caches a failure", async () => {
    let t = 0;
    await cachedRingoRead("k", async () => ok("good"), () => t);
    t = FRESH_MS + 1;
    expect((await cachedRingoRead("k", async () => ({ ok: false, status: 404, text: "gone" }), () => t)).status).toBe(404);
    clearRingoReadCache();
    await cachedRingoRead("k", async () => ({ ok: false, status: 500, text: "x" }), () => t);
    expect((await cachedRingoRead("k", async () => ok("fresh"), () => t)).text).toBe("fresh");
  });
});
