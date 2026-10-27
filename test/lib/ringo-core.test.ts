/**
 * The loader for ringo's `core`, not the renderers inside it.
 *
 * What `core` computes is ringo's to test, and it does (`core/*_test.go` in
 * btwhooks). What can go wrong HERE is the boundary: argv not arriving, stdin
 * cut short or decoded on the way in, stdout truncated when the module's
 * memory grows mid-run, a non-zero exit swallowed. So these cases are chosen
 * to cross that boundary in each direction, at sizes that force it to matter.
 */
import { describe, expect, it } from "vitest";
import { RingoCoreError, renderPaneLog, runRingoCore } from "../../lib/ringo-core.ts";
import { renderMarkdown } from "../../app/helpers/markdown-helper.ts";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("runRingoCore", () => {
  it("delivers stdin and returns stdout", async () => {
    const out = text(await runRingoCore(["counts"], utf8(`{"r":["done","closed","ready","draft"]}`)));
    // closed drops out of the total: 3 counted, 1 done, 2 open.
    expect(JSON.parse(out)).toEqual({ r: [3, 1, 2] });
  });

  it("agrees with the ported markdown helper, which is gated against the same Go", async () => {
    const src = "# Title\n\nsee [[story-a|the story]] and `code` — *it* **works**\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const theirs = text(await runRingoCore(["markdown"], utf8(src))).replaceAll("&#34;", "&quot;");
    expect(theirs).toBe(renderMarkdown(src).toString());
  });

  it("rejects with ringo's own stderr when the command exits non-zero", async () => {
    const failure = runRingoCore(["no-such-mode"], new Uint8Array());
    await expect(failure).rejects.toBeInstanceOf(RingoCoreError);
    await expect(failure).rejects.toMatchObject({ code: 2, message: expect.stringContaining("unknown mode: no-such-mode") });
  });

  it("keeps calls independent of one another", async () => {
    const runs = await Promise.all(
      [1, 2, 3, 4].map((n) => runRingoCore(["counts"], utf8(JSON.stringify({ r: Array(n).fill("done") })))),
    );
    expect(runs.map((r) => JSON.parse(text(r)).r[0])).toEqual([1, 2, 3, 4]);
  });
});

describe("renderPaneLog", () => {
  it("replays a repaint instead of stacking it, and escapes what it prints", async () => {
    const { html } = await renderPaneLog(utf8("one\r\n\x1b[1A\x1b[2Ktwo\r\n\x1b[32mgreen\x1b[m <b>&\r\n"));
    expect(html).not.toContain("one");
    expect(html).toContain("two\n");
    expect(html).toContain("green</span> &lt;b&gt;&amp;");
  });

  it("passes maxLines through as an argument", async () => {
    const log = utf8(Array.from({ length: 50 }, (_, i) => `line ${i}\n`).join(""));
    // Only the argument differs between the two, so only it can explain this.
    expect((await renderPaneLog(log)).lines).toBeGreaterThanOrEqual(50);
    expect((await renderPaneLog(log, 10)).lines).toBeLessThanOrEqual(10);
  });

  // tmux appends with no locking, so the last read can end anywhere. The log
  // goes in as bytes precisely so these reach the renderer unrepaired.
  it("tolerates a tail torn mid-escape-sequence", async () => {
    expect((await renderPaneLog(utf8("tail \x1b[38;5"))).html).toBe("tail \n");
  });

  it("tolerates a tail torn mid-UTF-8-sequence", async () => {
    const torn = new Uint8Array([...utf8("caf"), 0xc3]);
    expect((await renderPaneLog(torn)).html).toMatch(/^caf/);
  });

  it("carries multi-byte text through both directions intact", async () => {
    expect((await renderPaneLog(utf8("héllo ✓ 日本語\n"))).html).toBe("héllo ✓ 日本語\n");
  });

  // Megabytes in, so stdin arrives over many reads and the module grows its
  // memory while the host still holds views into it; and the shape of a real
  // agent log, where nearly every byte is a repaint of rows already drawn.
  //
  // ITS OWN TIME LIMIT, because replay is synchronous and CPU-bound: about a
  // second on an idle machine, and 5-34s measured with every core eight times
  // oversubscribed, where the default 5s failed it three runs in four. It only
  // ever timed out; the assertions never failed. The fixture is not shrunk to
  // fit instead, because megabytes are the property (see above).
  it("replays a multi-megabyte inline-repaint log down to its final rows", { timeout: 120_000 }, async () => {
    const frame = Array.from({ length: 6 }, (_, i) => `\x1b[38;5;${100 + i}m● step ${i}\x1b[0m ${"x".repeat(40)}\r\n`).join("");
    const repaint = `${frame}\x1b[6A\x1b[J`;
    const kept = 40;
    let log = "";
    for (let i = 0; i < kept; i++) log += repaint.repeat(250) + `committed ${i}\r\n`;
    const raw = utf8(log);
    expect(raw.length).toBeGreaterThan(4_000_000);

    const { html, lines } = await renderPaneLog(raw);
    expect(html.match(/committed \d+/g)).toHaveLength(kept);
    expect(lines).toBeLessThan(kept + 5);
    expect(raw.length / html.length).toBeGreaterThan(70);
  });
});
